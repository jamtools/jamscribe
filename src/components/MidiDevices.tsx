import React, {useEffect} from 'react';
import '../midi_devices_module';
import {useModule} from '../hooks/use_module';

const MIDI_DEVICE_REFRESH_INTERVAL_MS = 10_000;

export const MidiDevices: React.FC = () => {
    const midiDevicesModule = useModule('MidiDevices');
    const midiDevices = midiDevicesModule.midiDevicesSnapshot.useState().midiInputDevices;

    useEffect(() => {
        let isMounted = true;

        const refreshMidiInputDevices = async () => {
            try {
                await midiDevicesModule.actions.fetchMidiInputDevices();
            } catch (error) {
                if (isMounted) {
                    console.error('Failed to refresh MIDI input devices', error);
                }
            }
        };

        void refreshMidiInputDevices();
        const interval = window.setInterval(() => {
            void refreshMidiInputDevices();
        }, MIDI_DEVICE_REFRESH_INTERVAL_MS);

        return () => {
            isMounted = false;
            window.clearInterval(interval);
        };
    }, [midiDevicesModule]);

    return (
        <div className="card midi-devices-card">
            <div className="card-header">
                <h2 className="card-title">🎹 MIDI Input Devices</h2>
            </div>
            {midiDevices && midiDevices.length > 0 ? (
                <ul className="device-list">
                    {midiDevices.map((device, index) => (
                        <li key={index} className="device-item fade-in">
                            <span className="device-icon">🎹</span>
                            <span className="device-name">{device}</span>
                        </li>
                    ))}
                </ul>
            ) : (
                <div className="empty-state">
                    <div className="empty-state-icon">🎹</div>
                    <p className="text-muted mb-0">No MIDI input devices connected</p>
                    <p className="text-muted">Connect a MIDI device to start recording</p>
                </div>
            )}
        </div>
    );
};
