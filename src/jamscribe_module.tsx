// TODO: useState isn't working for some reason
import React, {useState} from 'react';

import springboard from 'springboard';

import '@jamtools/core/modules/io/io_module';
import 'springboard/modules/files/files_module';

import type {FileSaver, RecordingConfig} from './services/recorder';

// @platform "node"
import {uploadFile} from './services/upload_service';
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

const initialRecordingConfig: RecordingConfig = {
    inactivityTimeLimitSeconds: 60,
    uploaderUrl: '',
};

springboard.registerModule('JamScribe', {}, async (moduleAPI) => {
    if (moduleAPI.deps.core.isMaestro()) {
        await moduleAPI.getModule('io').ensureListening();
    }

    const recordingConfig = await moduleAPI.statesAPI.createPersistentState('recordingConfig', initialRecordingConfig);
    const draftRecordingConfig = await moduleAPI.statesAPI.createSharedState('draftRecordingConfig', recordingConfig.getState());

    // @platform "node"
    fileSaver = {
        writeFile: async (fileName, buffer) => {
            if (!fs.existsSync('./midi_files')) {
                fs.mkdirSync('midi_files')
            }

            await fs.promises.writeFile(fileName, buffer);

            try {
                await uploadFile(fileName, 'audio/midi', buffer, recordingConfig.getState().uploaderUrl);
            } catch (error) {
                console.error('Upload failed, but file saved locally:', error);
            }
        },
    };
    // @platform end

    const logMessages = await moduleAPI.statesAPI.createSharedState<LogMessage[]>('logMessages', []);
    const draftedFiles = await moduleAPI.statesAPI.createSharedState<DraftedFile[]>('draftedFiles', []);

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
    });

    moduleAPI.registerRoute('/', {}, () => (
        <Main
            logs={logMessages.useState()}
            availableFiles={draftedFiles.useState()}
            recordingConfig={recordingConfig.useState()}

            draftInactivityTimeLimit={draftRecordingConfig.useState().inactivityTimeLimitSeconds}
            onDraftInactivityTimeLimitChange={(limit: number) => actions.changeDraftInactivityTimeLimit({limit})}
            submitInactivityTimeLimitChange={() => actions.submitInactivityTimeLimit()}

            draftUploaderUrl={draftRecordingConfig.useState().uploaderUrl}
            onDraftUploaderUrlChange={(url: string) => actions.changeDraftUploaderUrl({url})}
            submitUploaderUrlChange={() => actions.submitUploaderUrl()}
        />
    ));

    // bail out if this is a presentation-only client
    if (!moduleAPI.deps.core.isMaestro()) {
        return;
    }

    // default implementation of file saver
    if (!fileSaver) {
        fileSaver = {
            writeFile: async (fileName, buffer) => {
                const filesModule = moduleAPI.deps.module.moduleRegistry.getModule('Files');
                const file = new File([
                    new Blob([buffer.toString()])
                ], fileName);

                filesModule.uploadFile(file);
            },
        };
    }

    const log = (msg: string) => {
        console.log(msg);
        logMessages.setState(logs => {
            return [...logs, { message: msg, timestamp: new Date(), id: Math.random().toString().slice(2) }]
        });
    }

    const ioModule = moduleAPI.deps.module.moduleRegistry.getModule('io');

    ioModule.midiDeviceStatusSubject.subscribe(device => {
        const msg = `Device '${device.name}' ${device.status}`;
        log(msg);
    });

    const recorder = new MidiRecorderImpl(ioModule.midiInputSubject, {log}, fileSaver, recordingConfig);
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

    draftInactivityTimeLimit: number;
    onDraftInactivityTimeLimitChange: (newLimit: number) => void;
    submitInactivityTimeLimitChange: () => void;

    draftUploaderUrl: string;
    onDraftUploaderUrlChange: (newUrl: string) => void;
    submitUploaderUrlChange: () => void;
}

const Main = ({
    logs,
    availableFiles,
    recordingConfig,
    draftInactivityTimeLimit,
    onDraftInactivityTimeLimitChange,
    submitInactivityTimeLimitChange,
    draftUploaderUrl,
    onDraftUploaderUrlChange,
    submitUploaderUrlChange
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
                recordingConfig={recordingConfig}
                draftInactivityTimeLimit={draftInactivityTimeLimit}
                onDraftInactivityTimeLimitChange={onDraftInactivityTimeLimitChange}
                submitInactivityTimeLimitChange={submitInactivityTimeLimitChange}
                draftUploaderUrl={draftUploaderUrl}
                onDraftUploaderUrlChange={onDraftUploaderUrlChange}
                submitUploaderUrlChange={submitUploaderUrlChange}
            />

            <div className="main-grid">
                <div>
                    <MidiDevices />

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
