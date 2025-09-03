// TODO: useState isn't working for some reason
import React from 'react';

import springboard from 'springboard';

import '@jamtools/core/modules/io/io_module';
import 'springboard/modules/files/files_module';

import type {FileSaver, RecordingConfig} from './services/recorder';

let fileSaver: FileSaver | undefined;

// @platform "node"
import fs from 'node:fs';
fileSaver = {
    writeFile: async (fileName, buffer) => {
        if (!fs.existsSync('./midi_files')) {
            fs.mkdirSync('midi_files')
        }

        const content = buffer.toString();
        await fs.promises.writeFile(fileName, content);
    },
};
// @platform end

import {MidiRecorderImpl} from './services/recorder';

type DraftedFile = {
    name: string;
    buffer: Buffer;
}

const initialRecordingConfig: RecordingConfig = {
    inactivityTimeLimitSeconds: 60,
};

springboard.registerModule('JamScribe', {}, async (moduleAPI) => {
    // @platform "node"
    await moduleAPI.getModule('io').ensureListening();
    // @platform end

    const recordingConfig = await moduleAPI.statesAPI.createPersistentState('recordingConfig', initialRecordingConfig);
    const draftRecordingConfig = await moduleAPI.statesAPI.createSharedState('draftRecordingConfig', recordingConfig.getState());

    const logMessages = await moduleAPI.statesAPI.createSharedState<string[]>('logMessages', []);
    const draftedFiles = await moduleAPI.statesAPI.createSharedState<DraftedFile[]>('draftedFiles', []);

    const changeDraftInactivityTimeLimit = moduleAPI.createAction('changeDraftInactivityTimeLimit', {}, async ({limit}: {limit: number}) => {
        draftRecordingConfig.setState(c => ({...c, inactivityTimeLimitSeconds: limit}));
    });

    const submitInactivityTimeLimit = moduleAPI.createAction('submitInactivityTimeLimit', {}, async () => {
        recordingConfig.setState(c => ({...c, inactivityTimeLimitSeconds: draftRecordingConfig.getState().inactivityTimeLimitSeconds}));
    });

    moduleAPI.registerRoute('/', {}, () => (
        <Main
            logs={logMessages.useState()}
            availableFiles={draftedFiles.useState()}
            recordingConfig={recordingConfig.useState()}

            draftInactivityTimeLimit={draftRecordingConfig.useState().inactivityTimeLimitSeconds}
            onDraftInactivityTimeLimitChange={(limit: number) => changeDraftInactivityTimeLimit({limit})}
            submitInactivityTimeLimitChange={() => submitInactivityTimeLimit({})}
        />
    ));

    // bail out if this is a presentation-only client
    if (!moduleAPI.deps.core.isMaestro()) {
        return;
    }

    // default implementation of file saver
    if (!fileSaver) {
        fileSaver = {
            writeFile: (fileName, buffer) => {
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
            return [...logs, msg]
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

type MainProps = {
    logs: string[];
    availableFiles: DraftedFile[];

    recordingConfig: RecordingConfig;

    draftInactivityTimeLimit: number;
    onDraftInactivityTimeLimitChange: (newLimit: number) => void;
    submitInactivityTimeLimitChange: () => void;
}

const Main = ({
    logs,
    availableFiles,
    recordingConfig,
    draftInactivityTimeLimit,
    onDraftInactivityTimeLimitChange,
    submitInactivityTimeLimitChange
}: MainProps) => {
    return (
        <>
            <details>
                <summary>
                    Config
                </summary>
                <pre>
                    {JSON.stringify(recordingConfig, null, 2)}
                </pre>
                <input
                    type='number'
                    value={draftInactivityTimeLimit}
                    onChange={(e) => onDraftInactivityTimeLimitChange(parseInt(e.target.value))}
                />
                <button
                    type='button'
                    onClick={() => submitInactivityTimeLimitChange()}
                >
                    Submit
                </button>
            </details>
            <div style={{border: '1px solid'}}>
                Files
                <ul>
                    {availableFiles.map(file => (
                        <li
                            key={file.name}
                            onClick={() => {

                            }}
                        >
                            {file.name}
                        </li>
                    ))}
                </ul>
            </div>
            <div style={{border: '1px solid'}}>
                <ul>
                    {logs.map((msg, i) => (
                        <li key={i}>
                            {msg}
                        </li>
                    ))}
                </ul>
            </div>
        </>
    );
}
