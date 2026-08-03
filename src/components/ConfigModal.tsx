import React, { useRef, useEffect } from 'react';
import type {AudioDeviceInfo, AudioRecordingConfig} from '../services/audio_types';
import {BUILD_COMMIT_HASH} from '../build_info';

type ConfigModalProps = {
    isOpen: boolean;
    onClose: () => void;
    audioInputDevices: AudioDeviceInfo[];
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
};

export function asModal<P extends { isOpen: boolean; onClose: () => void }>(
    Component: React.ComponentType<P>
) {
    return (props: P) => {
        const dialogRef = useRef<HTMLDialogElement>(null);

        useEffect(() => {
            const dialog = dialogRef.current;
            if (!dialog) return;

            if (props.isOpen) {
                dialog.showModal();
            } else {
                dialog.close();
            }
        }, [props.isOpen]);

        const handleClose = () => {
            props.onClose();
        };

        return (
            <dialog ref={dialogRef} onClose={handleClose}>
                <Component {...props} />
            </dialog>
        );
    };
}

function ConfigModalBase({
    onClose,
    audioInputDevices,
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
}: ConfigModalProps) {
    const selectedAudioDeviceIsListed =
        draftAudioConfig.deviceId === 'default' ||
        audioInputDevices.some(device => device.id === draftAudioConfig.deviceId);

    return (
        <div>
            <div className="modal-header">
                <h2 className="modal-title">⚙️ Recording Settings</h2>
                <p className="text-muted" style={{fontSize: '0.75rem', margin: '0.25rem 0 0'}}>
                    Build commit: <code>{BUILD_COMMIT_HASH}</code>
                </p>
            </div>
            <div className="modal-body">
                <div className="form-group">
                    <label className="form-label" htmlFor="inactivity-limit">
                        Inactivity Time Limit (seconds)
                    </label>
                    <input
                        id="inactivity-limit"
                        type='number'
                        className='form-input'
                        value={draftInactivityTimeLimit}
                        onChange={(e) => onDraftInactivityTimeLimitChange(parseInt(e.target.value))}
                        min={1}
                        max={300}
                    />
                    <p className="text-muted" style={{fontSize: '0.875rem', marginTop: '0.5rem'}}>
                        Recording will automatically stop after this many seconds of inactivity
                    </p>
                </div>

                <div className="form-group">
                    <label className="form-label" htmlFor="uploader-url">
                        Uploader URL
                    </label>
                    <input
                        id="uploader-url"
                        type='text'
                        className='form-input'
                        value={draftUploaderUrl}
                        onChange={(e) => onDraftUploaderUrlChange(e.target.value)}
                        placeholder="https://example.com/upload"
                    />
                    <p className="text-muted" style={{fontSize: '0.875rem', marginTop: '0.5rem'}}>
                        URL endpoint for uploading recorded files (leave empty to disable uploads)
                    </p>
                </div>

                <div className="form-group">
                    <label className="form-label">
                        <input
                            type="checkbox"
                            checked={draftAudioConfig.enabled}
                            onChange={(event) => onDraftAudioEnabledChange(event.target.checked)}
                            style={{marginRight: '0.5rem'}}
                        />
                        Record audio with each MIDI session
                    </label>
                    <p className="text-muted" style={{fontSize: '0.875rem', marginTop: '0.5rem'}}>
                        On Linux/Raspberry Pi, JamScribe records WAV audio with arecord piped through sox for channel selection.
                    </p>
                </div>

                <div className="form-group">
                    <div style={{display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center'}}>
                        <label className="form-label" htmlFor="audio-device">
                            Audio Device
                        </label>
                        <button type="button" className="btn-outline" onClick={refreshAudioInputDevices}>Refresh devices</button>
                    </div>
                    <select
                        id="audio-device"
                        className="form-input"
                        value={draftAudioConfig.deviceId}
                        onChange={(event) => {
                            const option = event.currentTarget.selectedOptions[0];
                            onDraftAudioDeviceChange(event.target.value, option?.textContent || event.target.value);
                        }}
                    >
                        <option value="default">Default ALSA input</option>
                        {!selectedAudioDeviceIsListed && (
                            <option value={draftAudioConfig.deviceId}>
                                {draftAudioConfig.deviceLabel || draftAudioConfig.deviceId}
                            </option>
                        )}
                        {audioInputDevices.map(device => (
                            <option key={device.id} value={device.id}>{device.label}</option>
                        ))}
                    </select>
                    <p className="text-muted" style={{fontSize: '0.875rem', marginTop: '0.5rem'}}>
                        Devices come from <code>arecord -l</code>. JamScribe prefers <code>plughw</code> entries so USB interfaces like Scarlett 2i2 can use ALSA format/rate conversion when needed.
                    </p>
                </div>

                <div className="form-group">
                    <label className="form-label" htmlFor="audio-channel">
                        Channel to Record
                    </label>
                    <input
                        id="audio-channel"
                        type="number"
                        className="form-input"
                        value={draftAudioConfig.channel}
                        onChange={(event) => onDraftAudioChannelChange(parseInt(event.target.value) || 1)}
                        min={1}
                        max={32}
                    />
                    <p className="text-muted" style={{fontSize: '0.875rem', marginTop: '0.5rem'}}>
                        1-based source channel to remix into the saved mono WAV file.
                    </p>
                </div>

                <div className="form-group">
                    <label className="form-label" htmlFor="audio-channel-count">
                        Source Channel Count
                    </label>
                    <input
                        id="audio-channel-count"
                        type="number"
                        className="form-input"
                        value={draftAudioConfig.channelCount}
                        onChange={(event) => onDraftAudioChannelCountChange(parseInt(event.target.value) || 1)}
                        min={draftAudioConfig.channel}
                        max={32}
                    />
                    <p className="text-muted" style={{fontSize: '0.875rem', marginTop: '0.5rem'}}>
                        Number of channels to request from arecord. This must be at least the selected channel.
                    </p>
                </div>

                <div className="form-group">
                    <label className="form-label" htmlFor="audio-sample-rate">
                        Audio Sample Rate
                    </label>
                    <input
                        id="audio-sample-rate"
                        type="number"
                        className="form-input"
                        value={draftAudioConfig.sampleRate}
                        onChange={(event) => onDraftAudioSampleRateChange(parseInt(event.target.value) || 44100)}
                        min={8000}
                        max={192000}
                        step={1000}
                    />
                </div>

                <div className="form-group">
                    <button
                        type="button"
                        className="btn-outline"
                        onClick={testDraftAudioInput}
                        disabled={!draftAudioConfig.enabled}
                    >
                        Test audio input
                    </button>
                    <p className="text-muted" style={{fontSize: '0.875rem', marginTop: '0.5rem'}}>
                        Records a short temporary WAV using the current draft settings, then deletes it. Result appears in Recording Status.
                    </p>
                </div>
            </div>
            <div className="modal-footer">
                <button
                    type='button'
                    className='btn-secondary'
                    onClick={onClose}
                >
                    Cancel
                </button>
                <button
                    type='button'
                    className='btn-primary'
                    onClick={() => {
                        submitInactivityTimeLimitChange();
                        submitUploaderUrlChange();
                        submitAudioRecordingConfigChange();
                        onClose();
                    }}
                >
                    Save Changes
                </button>
            </div>
        </div>
    );
}

export const ConfigModal = asModal(ConfigModalBase);
