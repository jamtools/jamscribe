// @platform "node"
import {ChildProcessWithoutNullStreams, execFile, spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';

import type {AudioDeviceInfo, AudioRecorder, AudioRecorderStartArgs, RecordedAudioFile} from './audio_types';

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

export const sanitizeRecordingFilePart = (value: string): string => value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'recording';

export const generateAudioFileName = (takeId: string, channel: number): string => {
    return `${sanitizeRecordingFilePart(takeId)}_audio_ch${channel}.wav`;
};

export const parseArecordListOutput = (stdout: string): AudioDeviceInfo[] => {
    const devices: AudioDeviceInfo[] = [];
    const seen = new Set<string>();
    const deviceLinePattern = /^card\s+(\d+):\s+([^\[]+)\[([^\]]+)\],\s+device\s+(\d+):\s+([^\[]+)\[([^\]]+)\]/;

    for (const line of stdout.split(/\r?\n/)) {
        const match = line.match(deviceLinePattern);
        if (!match) continue;

        const [, cardNumber, cardShortName, cardLongName, deviceNumber, deviceShortName, deviceLongName] = match;
        const id = `hw:${cardNumber},${deviceNumber}`;
        if (seen.has(id)) continue;
        seen.add(id);

        const cardName = (cardLongName || cardShortName || '').trim();
        const deviceName = (deviceLongName || deviceShortName || '').trim();
        const label = `${cardName}${deviceName && deviceName !== cardName ? ` · ${deviceName}` : ''} (${id})`;
        devices.push({id, label});
    }

    return devices;
};

export const listAlsaCaptureDevices = async (arecordPath = 'arecord'): Promise<AudioDeviceInfo[]> => {
    const {stdout} = await execFileAsync(arecordPath, ['-l']);
    return parseArecordListOutput(stdout);
};

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

export class LinuxAudioRecorder implements AudioRecorder {
    private running: RunningRecording | null = null;

    constructor(private options: LinuxAudioRecorderOptions = {}) {}

    async start({takeId, config}: AudioRecorderStartArgs): Promise<void> {
        if (!config.enabled) return;
        if (this.running) return;

        const outputDir = this.options.outputDir ?? DEFAULT_AUDIO_OUTPUT_DIR;
        await fs.promises.mkdir(outputDir, {recursive: true});

        const channel = Math.max(1, config.channel || 1);
        const channelCount = Math.max(channel, config.channelCount || channel);
        const sampleRate = Math.max(8000, config.sampleRate || 44100);
        const deviceId = config.deviceId || 'default';
        const fileName = generateAudioFileName(takeId, channel);
        const filePath = path.join(outputDir, fileName);
        const arecordPath = this.options.arecordPath ?? 'arecord';
        const soxPath = this.options.soxPath ?? 'sox';

        this.options.log?.(`Starting audio recording ${fileName} from ${deviceId} channel ${channel}/${channelCount}`);

        const arecord = spawn(arecordPath, [
            '-q',
            '-D', deviceId,
            '-f', 'S16_LE',
            '-r', String(sampleRate),
            '-c', String(channelCount),
            '-t', 'raw',
        ]);
        const sox = spawn(soxPath, [
            '-q',
            '-t', 'raw',
            '-b', '16',
            '-e', 'signed-integer',
            '-L',
            '-r', String(sampleRate),
            '-c', String(channelCount),
            '-',
            filePath,
            'remix',
            String(channel),
        ]);

        arecord.stdout.pipe(sox.stdin);

        const arecordClosed = waitForProcessClose(arecord, 'arecord');
        const soxClosed = waitForProcessClose(sox, 'sox');
        const settled = Promise.all([arecordClosed, soxClosed]).then(() => undefined);

        this.running = {takeId, fileName, filePath, arecord, sox, settled};
    }

    async stop(): Promise<RecordedAudioFile | null> {
        const running = this.running;
        if (!running) return null;
        this.running = null;

        if (!running.arecord.killed) {
            running.arecord.kill('SIGTERM');
        }

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
