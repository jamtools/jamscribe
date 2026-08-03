// @platform "node"
import {ChildProcessWithoutNullStreams, execFile, spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';

import type {AudioDeviceInfo, AudioRecorder, AudioRecorderStartArgs, AudioRecorderStopArgs, AudioRecordingConfig, RecordedAudioFile} from './audio_types';

const execFileAsync = promisify(execFile);

const DEFAULT_AUDIO_OUTPUT_DIR = './midi_files';

type LinuxAudioRecorderOptions = {
    outputDir?: string;
    arecordPath?: string;
    soxPath?: string;
    log?: (msg: string) => void;
};

type RunningRecording = {
    takeId: string;
    fileName: string;
    filePath: string;
    arecord: ChildProcessWithoutNullStreams;
    sox: ChildProcessWithoutNullStreams;
    settled: Promise<void>;
    stopRequested: {value: boolean};
};

type ParseArecordListOptions = {
    devicePrefix?: 'plughw' | 'hw';
};

type AudioProcessArgs = {
    deviceId: string;
    sampleRate: number;
    channelCount: number;
    durationSeconds?: number;
};

type SoxProcessArgs = {
    sampleRate: number;
    channelCount: number;
    selectedChannel: number;
    outputFilePath: string;
};

type SoxTrimArgs = {
    inputFilePath: string;
    outputFilePath: string;
    durationSeconds: number;
};

type AudioCaptureSmokeTestOptions = {
    outputDir?: string;
    arecordPath?: string;
    soxPath?: string;
    durationSeconds?: number;
    log?: (msg: string) => void;
};

export const sanitizeRecordingFilePart = (value: string): string => value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'recording';

export const generateAudioFileName = (takeId: string, channel: number): string => {
    return `${sanitizeRecordingFilePart(takeId)}_audio_ch${channel}.wav`;
};

export const parseArecordListOutput = (stdout: string, options: ParseArecordListOptions = {}): AudioDeviceInfo[] => {
    const devices: AudioDeviceInfo[] = [];
    const seen = new Set<string>();
    const deviceLinePattern = /^card\s+(\d+):\s+([^\[]+)\[([^\]]+)\],\s+device\s+(\d+):\s+([^\[]+)\[([^\]]+)\]/;
    const devicePrefix = options.devicePrefix ?? 'plughw';

    for (const line of stdout.split(/\r?\n/)) {
        const match = line.match(deviceLinePattern);
        if (!match) continue;

        const [, cardNumber, cardShortName, cardLongName, deviceNumber, deviceShortName, deviceLongName] = match;
        const hardwareId = `hw:${cardNumber},${deviceNumber}`;
        const id = `${devicePrefix}:${cardNumber},${deviceNumber}`;
        if (seen.has(id)) continue;
        seen.add(id);

        const cardName = (cardLongName || cardShortName || '').trim();
        const deviceName = (deviceLongName || deviceShortName || '').trim();
        const label = `${cardName}${deviceName && deviceName !== cardName ? ` · ${deviceName}` : ''} (${id})`;
        devices.push({id, label, hardwareId});
    }

    return devices;
};

export const listAlsaCaptureDevices = async (arecordPath = 'arecord'): Promise<AudioDeviceInfo[]> => {
    const {stdout} = await execFileAsync(arecordPath, ['-l']);
    return parseArecordListOutput(stdout);
};

export const buildArecordArgs = ({deviceId, sampleRate, channelCount, durationSeconds}: AudioProcessArgs): string[] => {
    const args = [
        '-D', deviceId,
        '-f', 'S16_LE',
        '-r', String(sampleRate),
        '-c', String(channelCount),
        '-t', 'raw',
    ];

    if (durationSeconds !== undefined) {
        args.push('-d', String(Math.max(1, Math.ceil(durationSeconds))));
    }

    return args;
};

export const buildSoxArgs = ({sampleRate, channelCount, selectedChannel, outputFilePath}: SoxProcessArgs): string[] => [
    '-t', 'raw',
    '-b', '16',
    '-e', 'signed-integer',
    '-L',
    '-r', String(sampleRate),
    '-c', String(channelCount),
    '-',
    outputFilePath,
    'remix',
    String(selectedChannel),
];

export const buildSoxTrimArgs = ({inputFilePath, outputFilePath, durationSeconds}: SoxTrimArgs): string[] => [
    inputFilePath,
    outputFilePath,
    'trim',
    '0',
    durationSeconds.toFixed(3),
];

const formatCommand = (command: string, args: string[]): string => [
    command,
    ...args.map(arg => /[\s"']/.test(arg) ? JSON.stringify(arg) : arg),
].join(' ');

const waitForProcessClose = (
    process: ChildProcessWithoutNullStreams,
    label: string,
    log?: (msg: string) => void,
    isExpectedNonZeroExit?: () => boolean,
): Promise<void> => new Promise((resolve, reject) => {
    let stderr = '';

    process.stderr.on('data', chunk => {
        const text = chunk.toString();
        stderr += text;
        const trimmed = text.trim();
        if (trimmed) {
            log?.(`${label} stderr: ${trimmed}`);
        }
    });
    process.on('error', error => {
        log?.(`${label} process error: ${error.message}`);
        reject(error);
    });
    process.on('close', (code, signal) => {
        log?.(`${label} closed with code ${code ?? 'null'} signal ${signal ?? 'null'}`);
        if (code === 0 || code === null) {
            resolve();
            return;
        }
        if (isExpectedNonZeroExit?.()) {
            log?.(`${label} non-zero exit was expected after stopping capture`);
            resolve();
            return;
        }
        reject(new Error(`${label} exited with code ${code} signal ${signal ?? 'null'}${stderr ? `: ${stderr.trim()}` : ''}`));
    });
});

const normalizeAudioSettings = (config: AudioRecordingConfig) => {
    const channel = Math.max(1, config.channel || 1);
    return {
        channel,
        channelCount: Math.max(channel, config.channelCount || channel),
        sampleRate: Math.max(8000, config.sampleRate || 44100),
        deviceId: config.deviceId || 'default',
    };
};

const pipeArecordToSox = (
    arecord: ChildProcessWithoutNullStreams,
    sox: ChildProcessWithoutNullStreams,
    log?: (msg: string) => void,
    isArecordExpectedNonZeroExit?: () => boolean,
): Promise<void> => {
    arecord.stdout.pipe(sox.stdin);
    const settled = Promise.all([
        waitForProcessClose(arecord, 'arecord', log, isArecordExpectedNonZeroExit),
        waitForProcessClose(sox, 'sox', log),
    ]).then(() => undefined);

    // The caller still awaits this promise. The extra catch prevents an early
    // child-process failure from becoming an unhandled rejection before stop()
    // or a smoke test can observe and report it.
    void settled.catch(() => undefined);
    return settled;
};

const terminateProcess = (
    process: ChildProcessWithoutNullStreams,
    label: string,
    log?: (msg: string) => void,
) => {
    if (!process.killed) {
        log?.(`Sending SIGTERM to ${label} pid ${process.pid ?? 'unknown'}`);
        process.kill('SIGTERM');
    }
};

const trimAudioFile = async (
    filePath: string,
    durationSeconds: number,
    soxPath: string,
    log?: (msg: string) => void,
) => {
    if (durationSeconds <= 0) {
        return;
    }

    const trimmedFilePath = `${filePath}.trimmed-${Date.now()}.wav`;
    const trimArgs = buildSoxTrimArgs({
        inputFilePath: filePath,
        outputFilePath: trimmedFilePath,
        durationSeconds,
    });

    log?.(`Trimming audio to ${durationSeconds.toFixed(3)}s with command: ${formatCommand(soxPath, trimArgs)}`);
    try {
        await execFileAsync(soxPath, trimArgs);
        await fs.promises.rename(trimmedFilePath, filePath);
    } catch (error) {
        await fs.promises.rm(trimmedFilePath, {force: true});
        throw error;
    }
};

export const testAlsaCaptureDevice = async (
    config: AudioRecordingConfig,
    options: AudioCaptureSmokeTestOptions = {},
): Promise<RecordedAudioFile> => {
    const outputDir = options.outputDir ?? DEFAULT_AUDIO_OUTPUT_DIR;
    await fs.promises.mkdir(outputDir, {recursive: true});

    const {channel, channelCount, sampleRate, deviceId} = normalizeAudioSettings(config);
    const fileName = generateAudioFileName(`audio-test-${new Date().toISOString()}`, channel);
    const filePath = path.join(outputDir, fileName);
    const durationSeconds = options.durationSeconds ?? 3;
    const arecordPath = options.arecordPath ?? 'arecord';
    const soxPath = options.soxPath ?? 'sox';

    const arecordArgs = buildArecordArgs({
        deviceId,
        sampleRate,
        channelCount,
        durationSeconds,
    });
    const soxArgs = buildSoxArgs({
        sampleRate,
        channelCount,
        selectedChannel: channel,
        outputFilePath: filePath,
    });

    options.log?.(`Testing audio input ${deviceId} channel ${channel}/${channelCount} for ${durationSeconds}s`);
    options.log?.(`Audio test arecord command: ${formatCommand(arecordPath, arecordArgs)}`);
    options.log?.(`Audio test sox command: ${formatCommand(soxPath, soxArgs)}`);

    const arecord = spawn(arecordPath, arecordArgs);
    const sox = spawn(soxPath, soxArgs);

    try {
        await pipeArecordToSox(arecord, sox, options.log);
        const stats = await fs.promises.stat(filePath);
        options.log?.(`Audio input test wrote ${stats.size} bytes to temporary WAV`);
        if (stats.size <= 44) {
            throw new Error('Audio test completed, but the WAV file did not contain audio samples');
        }
        options.log?.(`Audio input test succeeded: ${fileName}`);

        return {
            fileName,
            filePath,
            contentType: 'audio/wav',
        };
    } finally {
        terminateProcess(arecord, 'arecord', options.log);
        terminateProcess(sox, 'sox', options.log);
    }
};

export class LinuxAudioRecorder implements AudioRecorder {
    private running: RunningRecording | null = null;

    constructor(private options: LinuxAudioRecorderOptions = {}) {}

    async start({takeId, config}: AudioRecorderStartArgs): Promise<void> {
        if (!config.enabled) return;
        if (this.running) return;

        const outputDir = this.options.outputDir ?? DEFAULT_AUDIO_OUTPUT_DIR;
        await fs.promises.mkdir(outputDir, {recursive: true});

        const {channel, channelCount, sampleRate, deviceId} = normalizeAudioSettings(config);
        const fileName = generateAudioFileName(takeId, channel);
        const filePath = path.join(outputDir, fileName);
        const arecordPath = this.options.arecordPath ?? 'arecord';
        const soxPath = this.options.soxPath ?? 'sox';

        const arecordArgs = buildArecordArgs({deviceId, sampleRate, channelCount});
        const soxArgs = buildSoxArgs({
            sampleRate,
            channelCount,
            selectedChannel: channel,
            outputFilePath: filePath,
        });

        this.options.log?.(`Starting audio recording ${fileName} from ${deviceId} channel ${channel}/${channelCount}`);
        this.options.log?.(`Audio arecord command: ${formatCommand(arecordPath, arecordArgs)}`);
        this.options.log?.(`Audio sox command: ${formatCommand(soxPath, soxArgs)}`);

        const arecord = spawn(arecordPath, arecordArgs);
        const sox = spawn(soxPath, soxArgs);
        const stopRequested = {value: false};
        const settled = pipeArecordToSox(arecord, sox, this.options.log, () => stopRequested.value);

        this.running = {takeId, fileName, filePath, arecord, sox, settled, stopRequested};
    }

    async stop(args: AudioRecorderStopArgs = {}): Promise<RecordedAudioFile | null> {
        const running = this.running;
        if (!running) return null;
        this.running = null;

        this.options.log?.(`Stopping audio recording ${running.fileName} for take ${running.takeId}`);
        running.stopRequested.value = true;
        terminateProcess(running.arecord, 'arecord', this.options.log);

        await running.settled;
        if (args.trimDurationSeconds !== undefined) {
            await trimAudioFile(running.filePath, args.trimDurationSeconds, this.options.soxPath ?? 'sox', this.options.log);
        }
        const stats = await fs.promises.stat(running.filePath);
        this.options.log?.(`Audio saved: ${running.fileName} (${stats.size} bytes)`);

        return {
            fileName: running.fileName,
            filePath: running.filePath,
            contentType: 'audio/wav',
        };
    }
}
// @platform end
