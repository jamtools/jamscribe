// TODO: useState isn't working for some reason
import React, {useState} from 'react';

import springboard from 'springboard';

import '@jamtools/core/modules/io/io_module';
import 'springboard/modules/files/files_module';

import type {FileSaver} from './services/recorder';
import type {RecordingConfig} from './services/recording_config';
import {initialRecordingConfig} from './services/recording_config';
import type {AudioDeviceInfo, AudioRecordingConfig, AudioRecordingStatus} from './services/audio_types';
import {initialAudioRecordingConfig} from './services/audio_types';

// @platform "node"
import {uploadFile, uploadFileFromPath} from './services/upload_service';
import {LinuxAudioRecorder, listAlsaCaptureDevices, testAlsaCaptureDevice} from './services/linux_audio_recorder';
// @platform end

let fileSaver: FileSaver | undefined;

// @platform "node"
import fs from 'node:fs';
// fileSaver will be set inside the module after recordingConfig is available
// @platform end

import {MidiRecorderImpl} from './services/recorder';
import {ConfigModal} from './components/ConfigModal';
import {MidiDevices} from './components/MidiDevices';
import './styles.css';

type DraftedFile = {
    name: string;
    buffer: Buffer;
}

type PendingUpload = {
    id: string;
    fileName: string;
    filePath: string;
    contentType: string;
    attempts: number;
    lastAttemptTime: number;
    error?: string;
};

springboard.registerModule('JamScribe', {}, async (moduleAPI) => {
    if (moduleAPI.deps.core.isMaestro()) {
        await moduleAPI.getModule('io').ensureListening();
    }

    const recordingConfig = await moduleAPI.statesAPI.createPersistentState('recordingConfig', initialRecordingConfig);
    const audioRecordingConfig = await moduleAPI.statesAPI.createPersistentState('audioRecordingConfig', initialAudioRecordingConfig);
    const draftRecordingConfig = await moduleAPI.statesAPI.createSharedState('draftRecordingConfig', recordingConfig.getState());
    const draftAudioRecordingConfig = await moduleAPI.statesAPI.createSharedState('draftAudioRecordingConfig', audioRecordingConfig.getState());
    const pendingUploads = await moduleAPI.statesAPI.createPersistentState<PendingUpload[]>('pendingUploads', []);
    const audioInputDevices = await moduleAPI.statesAPI.createSharedState<AudioDeviceInfo[]>('audioInputDevices', []);
    const recordingStatus = await moduleAPI.statesAPI.createSharedState<AudioRecordingStatus>('recordingStatus', {state: 'idle'});

    // @platform "node"
    const recordingsDir = './midi_files';
    const ensureRecordingsDir = () => {
        if (!fs.existsSync(recordingsDir)) {
            fs.mkdirSync(recordingsDir, {recursive: true});
        }
    };

    const queuePendingUpload = (fileName: string, filePath: string, contentType: string, error: unknown) => {
        console.error('Upload failed, queuing for retry:', error);

        const uploadId = `${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
        pendingUploads.setState(uploads => [
            ...uploads,
            {
                id: uploadId,
                fileName,
                filePath,
                contentType,
                attempts: 1,
                lastAttemptTime: Date.now(),
                error: error instanceof Error ? error.message : String(error),
            },
        ]);
    };

    fileSaver = {
        writeFile: async (fileName, contentType, buffer) => {
            ensureRecordingsDir();

            const filePath = `${recordingsDir}/${fileName}`;
            await fs.promises.writeFile(filePath, buffer);

            try {
                await uploadFile(fileName, contentType, buffer, recordingConfig.getState().uploaderUrl);
            } catch (error) {
                queuePendingUpload(fileName, filePath, contentType, error);
            }
        },
        uploadFileFromPath: async (fileName, contentType, filePath) => {
            try {
                await uploadFileFromPath(fileName, contentType, filePath, recordingConfig.getState().uploaderUrl);
            } catch (error) {
                queuePendingUpload(fileName, filePath, contentType, error);
            }
        },
    };

    // Retry mechanism with exponential backoff
    const retryPendingUploads = async () => {
        const uploads = pendingUploads.getState();
        const now = Date.now();
        const MAX_ATTEMPTS = 10;

        for (const upload of uploads) {
            // Calculate exponential backoff: 1min, 2min, 4min, 8min, 16min, etc.
            const backoffMinutes = Math.pow(2, upload.attempts - 1);
            const backoffMs = backoffMinutes * 60 * 1000;
            const nextAttemptTime = upload.lastAttemptTime + backoffMs;

            // Skip if not time yet or max attempts reached
            if (now < nextAttemptTime || upload.attempts >= MAX_ATTEMPTS) {
                continue;
            }

            try {
                const uploaderUrl = recordingConfig.getState().uploaderUrl;
                if (!uploaderUrl) {
                    continue;
                }

                await uploadFileFromPath(upload.fileName, upload.contentType, upload.filePath, uploaderUrl);

                // Success! Remove from pending uploads
                pendingUploads.setState(uploads => uploads.filter(u => u.id !== upload.id));
                console.log(`Successfully uploaded ${upload.fileName} after ${upload.attempts} attempts`);
            } catch (error) {
                // Update attempt count and error
                pendingUploads.setState(uploads =>
                    uploads.map(u =>
                        u.id === upload.id
                            ? {
                                ...u,
                                attempts: u.attempts + 1,
                                lastAttemptTime: now,
                                error: error instanceof Error ? error.message : String(error),
                            }
                            : u
                    )
                );
                console.error(`Upload retry ${upload.attempts + 1} failed for ${upload.fileName}:`, error);

                // Remove from queue if max attempts reached
                if (upload.attempts + 1 >= MAX_ATTEMPTS) {
                    console.error(`Max retry attempts reached for ${upload.fileName}, removing from queue`);
                    pendingUploads.setState(uploads => uploads.filter(u => u.id !== upload.id));
                }
            }
        }
    };

    // Check for pending uploads every minute
    const retryInterval = setInterval(() => {
        retryPendingUploads().catch(err => {
            console.error('Error in retry mechanism:', err);
        });
    }, 60 * 1000);

    // Try to upload any pending uploads from previous sessions on startup
    setTimeout(() => {
        retryPendingUploads().catch(err => {
            console.error('Error in initial retry attempt:', err);
        });
    }, 5000); // Wait 5 seconds after startup
    // @platform end

    const logMessages = await moduleAPI.statesAPI.createSharedState<LogMessage[]>('logMessages', []);
    const draftedFiles = await moduleAPI.statesAPI.createSharedState<DraftedFile[]>('draftedFiles', []);

    const log = (msg: string) => {
        console.log(msg);
        logMessages.setState(logs => {
            return [...logs, { message: msg, timestamp: new Date(), id: Math.random().toString().slice(2) }]
        });
    }

    const actions = moduleAPI.createActions({
        changeDraftInactivityTimeLimit: async ({limit}: {limit: number}) => {
            draftRecordingConfig.setState(c => ({...c, inactivityTimeLimitSeconds: limit}));
        },
        submitInactivityTimeLimit: async () => {
            recordingConfig.setState(c => ({...c, inactivityTimeLimitSeconds: draftRecordingConfig.getState().inactivityTimeLimitSeconds}));
        },
        changeDraftUploaderUrl: async ({url}: {url: string}) => {
            draftRecordingConfig.setState(c => ({...c, uploaderUrl: url}));
        },
        submitUploaderUrl: async () => {
            recordingConfig.setState(c => ({...c, uploaderUrl: draftRecordingConfig.getState().uploaderUrl}));
        },
        changeDraftAudioEnabled: async ({enabled}: {enabled: boolean}) => {
            draftAudioRecordingConfig.setState(c => ({...c, enabled}));
        },
        changeDraftAudioDevice: async ({deviceId, deviceLabel}: {deviceId: string; deviceLabel: string}) => {
            draftAudioRecordingConfig.setState(c => ({...c, deviceId, deviceLabel}));
        },
        changeDraftAudioChannel: async ({channel}: {channel: number}) => {
            draftAudioRecordingConfig.setState(c => {
                const safeChannel = Math.max(1, channel);
                return {...c, channel: safeChannel, channelCount: Math.max(c.channelCount, safeChannel)};
            });
        },
        changeDraftAudioChannelCount: async ({channelCount}: {channelCount: number}) => {
            draftAudioRecordingConfig.setState(c => ({...c, channelCount: Math.max(c.channel, channelCount)}));
        },
        changeDraftAudioSampleRate: async ({sampleRate}: {sampleRate: number}) => {
            draftAudioRecordingConfig.setState(c => ({...c, sampleRate: Math.max(8000, sampleRate)}));
        },
        submitAudioRecordingConfig: async () => {
            audioRecordingConfig.setState(draftAudioRecordingConfig.getState());
        },
        refreshAudioInputDevices: async () => {
            // @platform "node"
            const devices = await listAlsaCaptureDevices();
            audioInputDevices.setState(devices);
            return {devices};
            // @platform end
            return {devices: audioInputDevices.getState()};
        },
        testDraftAudioInput: async () => {
            const audioConfig = draftAudioRecordingConfig.getState();
            if (!audioConfig.enabled) {
                recordingStatus.setState({
                    state: 'idle',
                    message: 'Enable audio recording before testing an input.',
                });
                return {ok: false};
            }

            recordingStatus.setState({
                state: 'testing',
                message: `Testing ${audioConfig.deviceLabel || audioConfig.deviceId} channel ${audioConfig.channel}...`,
            });

            try {
                // @platform "node"
                await testAlsaCaptureDevice(audioConfig, {outputDir: recordingsDir, log});
                // @platform end
                recordingStatus.setState({
                    state: 'idle',
                    message: `Audio test succeeded for ${audioConfig.deviceLabel || audioConfig.deviceId} channel ${audioConfig.channel}.`,
                });
                return {ok: true};
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                recordingStatus.setState({
                    state: 'error',
                    message: `Audio test failed: ${message}`,
                });
                return {ok: false, error: message};
            }
        },
    });

    // @platform "node"
    void actions.refreshAudioInputDevices().catch(error => {
        console.error('Failed to list ALSA capture devices:', error);
    });
    // @platform end

    moduleAPI.registerRoute('/', {}, () => (
        <Main
            logs={logMessages.useState()}
            availableFiles={draftedFiles.useState()}
            recordingConfig={recordingConfig.useState()}
            audioRecordingConfig={audioRecordingConfig.useState()}
            audioInputDevices={audioInputDevices.useState()}
            recordingStatus={recordingStatus.useState()}

            draftInactivityTimeLimit={draftRecordingConfig.useState().inactivityTimeLimitSeconds}
            onDraftInactivityTimeLimitChange={(limit: number) => actions.changeDraftInactivityTimeLimit({limit})}
            submitInactivityTimeLimitChange={() => actions.submitInactivityTimeLimit()}

            draftUploaderUrl={draftRecordingConfig.useState().uploaderUrl}
            onDraftUploaderUrlChange={(url: string) => actions.changeDraftUploaderUrl({url})}
            submitUploaderUrlChange={() => actions.submitUploaderUrl()}

            draftAudioConfig={draftAudioRecordingConfig.useState()}
            onDraftAudioEnabledChange={(enabled: boolean) => actions.changeDraftAudioEnabled({enabled})}
            onDraftAudioDeviceChange={(deviceId: string, deviceLabel: string) => actions.changeDraftAudioDevice({deviceId, deviceLabel})}
            onDraftAudioChannelChange={(channel: number) => actions.changeDraftAudioChannel({channel})}
            onDraftAudioChannelCountChange={(channelCount: number) => actions.changeDraftAudioChannelCount({channelCount})}
            onDraftAudioSampleRateChange={(sampleRate: number) => actions.changeDraftAudioSampleRate({sampleRate})}
            submitAudioRecordingConfigChange={() => actions.submitAudioRecordingConfig()}
            refreshAudioInputDevices={() => actions.refreshAudioInputDevices()}
            testDraftAudioInput={() => actions.testDraftAudioInput()}
        />
    ));

    // bail out if this is a presentation-only client
    if (!moduleAPI.deps.core.isMaestro()) {
        return;
    }

    // default implementation of file saver
    if (!fileSaver) {
        fileSaver = {
            writeFile: async (fileName, _contentType, buffer) => {
                const filesModule = moduleAPI.deps.module.moduleRegistry.getModule('Files');
                const file = new File([
                    new Blob([buffer.toString()])
                ], fileName);

                filesModule.uploadFile(file);
            },
        };
    }

    const ioModule = moduleAPI.deps.module.moduleRegistry.getModule('io');

    ioModule.midiDeviceStatusSubject.subscribe(device => {
        const msg = `Device '${device.name}' ${device.status}`;
        log(msg);
    });

    let audioRecorder;
    // @platform "node"
    audioRecorder = new LinuxAudioRecorder({outputDir: recordingsDir, log});
    // @platform end

    const recorder = new MidiRecorderImpl(
        ioModule.midiInputSubject,
        {log},
        fileSaver,
        recordingConfig,
        audioRecordingConfig,
        audioRecorder,
        recordingStatus,
    );
    recorder.initialize();
});

type LogMessage = {
    id: string;
    message: string;
    timestamp: Date;
};

type MainProps = {
    logs: LogMessage[];
    availableFiles: DraftedFile[];

    recordingConfig: RecordingConfig;
    audioRecordingConfig: AudioRecordingConfig;
    audioInputDevices: AudioDeviceInfo[];
    recordingStatus: AudioRecordingStatus;

    draftInactivityTimeLimit: number;
    onDraftInactivityTimeLimitChange: (newLimit: number) => void;
    submitInactivityTimeLimitChange: () => void;

    draftUploaderUrl: string;
    onDraftUploaderUrlChange: (newUrl: string) => void;
    submitUploaderUrlChange: () => void;

    draftAudioConfig: AudioRecordingConfig;
    onDraftAudioEnabledChange: (enabled: boolean) => void;
    onDraftAudioDeviceChange: (deviceId: string, deviceLabel: string) => void;
    onDraftAudioChannelChange: (channel: number) => void;
    onDraftAudioChannelCountChange: (channelCount: number) => void;
    onDraftAudioSampleRateChange: (sampleRate: number) => void;
    submitAudioRecordingConfigChange: () => void;
    refreshAudioInputDevices: () => void;
    testDraftAudioInput: () => void;
}

const Main = ({
    logs,
    availableFiles,
    recordingConfig,
    audioRecordingConfig,
    audioInputDevices,
    recordingStatus,
    draftInactivityTimeLimit,
    onDraftInactivityTimeLimitChange,
    submitInactivityTimeLimitChange,
    draftUploaderUrl,
    onDraftUploaderUrlChange,
    submitUploaderUrlChange,
    draftAudioConfig,
    onDraftAudioEnabledChange,
    onDraftAudioDeviceChange,
    onDraftAudioChannelChange,
    onDraftAudioChannelCountChange,
    onDraftAudioSampleRateChange,
    submitAudioRecordingConfigChange,
    refreshAudioInputDevices,
    testDraftAudioInput,
}: MainProps) => {
    const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);

    return (
        <div className="app-container">
            <header className="app-header">
                <h1 className="app-title">🎵 JamScribe</h1>
                <button
                    type='button'
                    className='btn-primary'
                    onClick={() => setIsConfigModalOpen(true)}
                >
                    ⚙️ Settings
                </button>
            </header>

            <ConfigModal
                isOpen={isConfigModalOpen}
                onClose={() => setIsConfigModalOpen(false)}
                audioInputDevices={audioInputDevices}
                draftInactivityTimeLimit={draftInactivityTimeLimit}
                onDraftInactivityTimeLimitChange={onDraftInactivityTimeLimitChange}
                submitInactivityTimeLimitChange={submitInactivityTimeLimitChange}
                draftUploaderUrl={draftUploaderUrl}
                onDraftUploaderUrlChange={onDraftUploaderUrlChange}
                submitUploaderUrlChange={submitUploaderUrlChange}
                draftAudioConfig={draftAudioConfig}
                onDraftAudioEnabledChange={onDraftAudioEnabledChange}
                onDraftAudioDeviceChange={onDraftAudioDeviceChange}
                onDraftAudioChannelChange={onDraftAudioChannelChange}
                onDraftAudioChannelCountChange={onDraftAudioChannelCountChange}
                onDraftAudioSampleRateChange={onDraftAudioSampleRateChange}
                submitAudioRecordingConfigChange={submitAudioRecordingConfigChange}
                refreshAudioInputDevices={refreshAudioInputDevices}
                testDraftAudioInput={testDraftAudioInput}
            />

            <div className="main-grid">
                <div>
                    <RecordingStatusPanel status={recordingStatus} audioConfig={audioRecordingConfig} />
                    <MidiDevices />
                    <AudioDevices devices={audioInputDevices} config={audioRecordingConfig} onRefresh={refreshAudioInputDevices} />

                    <div className="card">
                        <div className="card-header">
                            <h2 className="card-title">📁 Recorded Files</h2>
                        </div>
                        {availableFiles.length > 0 ? (
                            <div className="files-grid">
                                {availableFiles.map(file => (
                                    <div
                                        key={file.name}
                                        className="file-item fade-in"
                                        onClick={() => {
                                            // Handle file click
                                        }}
                                    >
                                        <div className="file-icon">🎼</div>
                                        <div className="file-name">{file.name}</div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="empty-state">
                                <div className="empty-state-icon">📭</div>
                                <p className="text-muted">No recordings yet. Start playing to record MIDI!</p>
                            </div>
                        )}
                    </div>
                </div>

                <div className="card logs-card">
                    <div className="card-header">
                        <h2 className="card-title">📋 Activity Log</h2>
                    </div>
                    <ul className="log-list">
                        {logs.length > 0 ? (
                            [...logs].reverse().map((logEntry) => {
                                const formatTime = (date: Date | string | number) => {
                                    const dateObj = new Date(date);
                                    const now = new Date();
                                    const isToday = dateObj.toDateString() === now.toDateString();
                                    const timeStr = dateObj.toLocaleTimeString('en-US', {
                                        hour: 'numeric',
                                        minute: '2-digit',
                                        hour12: true
                                    });

                                    if (isToday) {
                                        return timeStr;
                                    } else {
                                        const dateStr = dateObj.toLocaleDateString('en-US', {
                                            month: 'short',
                                            day: 'numeric'
                                        });
                                        return `${dateStr} ${timeStr}`;
                                    }
                                };

                                return (
                                    <li key={logEntry.id} className='log-item fade-in'>
                                        <span className="log-timestamp">{formatTime(logEntry.timestamp)}</span>
                                        <span className="log-message">{logEntry.message}</span>
                                    </li>
                                );
                            })
                        ) : (
                            <li className="log-item text-muted">
                                Waiting for activity...
                            </li>
                        )}
                    </ul>
                </div>
            </div>
        </div>
    );
}

const RecordingStatusPanel = ({status, audioConfig}: {status: AudioRecordingStatus; audioConfig: AudioRecordingConfig}) => {
    const isRecording = status.state === 'recording' || status.state === 'stopping' || status.state === 'testing';
    return (
        <div className="card">
            <div className="card-header">
                <h2 className="card-title">🔴 Recording Status</h2>
                <span className={`recording-status ${isRecording ? 'active' : ''}`}>
                    <span className="recording-indicator" />
                    {status.state}
                </span>
            </div>
            <p className="text-muted mb-0">{status.message || 'Waiting for MIDI activity...'}</p>
            {status.activeTakeId && <p className="text-muted mb-0">Take: {status.activeTakeId}</p>}
            {status.audioFileName && <p className="text-muted mb-0">Audio: {status.audioFileName}</p>}
            <p className="text-muted mb-0">Audio recording is {audioConfig.enabled ? 'enabled' : 'disabled'}.</p>
        </div>
    );
};

const AudioDevices = ({devices, config, onRefresh}: {devices: AudioDeviceInfo[]; config: AudioRecordingConfig; onRefresh: () => void}) => {
    return (
        <div className="card">
            <div className="card-header">
                <h2 className="card-title">🎙️ Audio Input Devices</h2>
                <button type="button" className="btn-outline" onClick={onRefresh}>Refresh</button>
            </div>
            <p className="text-muted">
                Selected: {config.deviceLabel || config.deviceId}, channel {config.channel} of {config.channelCount}
            </p>
            {devices.length > 0 ? (
                <ul className="device-list">
                    {devices.map(device => (
                        <li key={device.id} className="device-item fade-in">
                            <span className="device-icon">🎙️</span>
                            <span className="device-name">
                                {device.label}
                                {device.hardwareId && device.hardwareId !== device.id ? ` · hardware ${device.hardwareId}` : ''}
                            </span>
                        </li>
                    ))}
                </ul>
            ) : (
                <div className="empty-state">
                    <div className="empty-state-icon">🎙️</div>
                    <p className="text-muted mb-0">No ALSA capture devices found</p>
                    <p className="text-muted">Install/configure ALSA devices on the Raspberry Pi, then refresh.</p>
                </div>
            )}
        </div>
    );
};
