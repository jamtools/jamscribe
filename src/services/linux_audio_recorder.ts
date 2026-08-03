// @platform "node"
import {ChildProcessWithoutNullStreams, execFile, spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';

import type {AudioDeviceInfo, AudioRecorder, AudioRecorderStartArgs, AudioRecordingConfig, RecordedAudioFile} from './audio_types';

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
        '-q',
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
    '-q',
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

const waitForProcessClose = (process: ChildProcessWithoutNullStreams, label: string): Promise<void> => new Promise((resolve, reject) => {
    let stderr = '';

    process.stderr.on('data', chunk => {
        stderr += chunk.toString();
    });
    process.on('error', reject);
    process.on('close', code => {
        if (code === 0 || code === null) {
            resolve();
            return;
        }
        reject(new Error(`${label} exited with code ${code}${stderr ? `: ${stderr}` : ''}`));
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
): Promise<void> => {
    arecord.stdout.pipe(sox.stdin);
    const settled = Promise.all([
        waitForProcessClose(arecord, 'arecord'),
        waitForProcessClose(sox, 'sox'),
    ]).then(() => undefined);

    // The caller still awaits this promise. The extra catch prevents an early
    // child-process failure from becoming an unhandled rejection before stop()
    // or a smoke test can observe and report it.
    void settled.catch(() => undefined);
    return settled;
};

const terminateProcess = (process: ChildProcessWithoutNullStreams) => {
    if (!process.killed) {
        process.kill('SIGTERM');
    }
};

export const testAlsaCaptureDevice = async (
    config: AudioRecordingConfig,
    options: AudioCaptureSmokeTestOptions = {},
): Promise<void> => {
    const outputDir = options.outputDir ?? DEFAULT_AUDIO_OUTPUT_DIR;
    await fs.promises.mkdir(outputDir, {recursive: true});

    const {channel, channelCount, sampleRate, deviceId} = normalizeAudioSettings(config);
    const filePath = path.join(outputDir, `.jamscribe_audio_test_${Date.now()}_${Math.random().toString(36).slice(2)}.wav`);
    const durationSeconds = options.durationSeconds ?? 3;
    const arecordPath = options.arecordPath ?? 'arecord';
    const soxPath = options.soxPath ?? 'sox';

    options.log?.(`Testing audio input ${deviceId} channel ${channel}/${channelCount} for ${durationSeconds}s`);

    const arecord = spawn(arecordPath, buildArecordArgs({
        deviceId,
        sampleRate,
        channelCount,
        durationSeconds,
    }));
    const sox = spawn(soxPath, buildSoxArgs({
        sampleRate,
        channelCount,
        selectedChannel: channel,
        outputFilePath: filePath,
    }));

    try {
        await pipeArecordToSox(arecord, sox);
        const stats = await fs.promises.stat(filePath);
        if (stats.size <= 44) {
            throw new Error('Audio test completed, but the WAV file did not contain audio samples');
        }
        options.log?.('Audio input test succeeded');
    } finally {
        terminateProcess(arecord);
        terminateProcess(sox);
        await fs.promises.rm(filePath, {force: true});
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

        this.options.log?.(`Starting audio recording ${fileName} from ${deviceId} channel ${channel}/${channelCount}`);

        const arecord = spawn(arecordPath, buildArecordArgs({deviceId, sampleRate, channelCount}));
        const sox = spawn(soxPath, buildSoxArgs({
            sampleRate,
            channelCount,
            selectedChannel: channel,
            outputFilePath: filePath,
        }));
        const settled = pipeArecordToSox(arecord, sox);

        this.running = {takeId, fileName, filePath, arecord, sox, settled};
    }

    async stop(): Promise<RecordedAudioFile | null> {
        const running = this.running;
        if (!running) return null;
        this.running = null;

        terminateProcess(running.arecord);

        await running.settled;
        this.options.log?.(`Audio saved: ${running.fileName}`);

        return {
            fileName: running.fileName,
            filePath: running.filePath,
            contentType: 'audio/wav',
        };
    }
}
// @platform end
