import '@jamtools/core/modules/io/io_module';

import springboard from 'springboard';
import type {StateSupervisor} from 'springboard/services/states/shared_state_service';

export type MidiDevicesSnapshot = {
    midiInputDevices: string[];
    lastUpdatedAt: number | null;
};

type MidiDevicesModuleActions = {
    fetchMidiInputDevices: () => Promise<MidiDevicesSnapshot>;
};

export type MidiDevicesModule = {
    midiDevicesSnapshot: StateSupervisor<MidiDevicesSnapshot>;
    actions: MidiDevicesModuleActions;
};

declare module 'springboard/module_registry/module_registry' {
    interface AllModules {
        MidiDevices: MidiDevicesModule;
    }
}

const EMPTY_SNAPSHOT: MidiDevicesSnapshot = {
    midiInputDevices: [],
    lastUpdatedAt: null,
};

const uniqueDeviceNames = (deviceNames: string[]): string[] => {
    return [...new Set(deviceNames.map(deviceName => deviceName.trim()).filter(Boolean))];
};

springboard.registerModule('MidiDevices', {}, async (moduleAPI): Promise<MidiDevicesModule> => {
    const ioModule = moduleAPI.getModule('io');
    const midiDevicesSnapshot = await moduleAPI.statesAPI.createSharedState<MidiDevicesSnapshot>(
        'server_midi_devices_snapshot',
        EMPTY_SNAPSHOT,
    );

    const setMidiInputDevices = (midiInputDevices: string[]): MidiDevicesSnapshot => {
        return midiDevicesSnapshot.setState({
            midiInputDevices: uniqueDeviceNames(midiInputDevices),
            lastUpdatedAt: Date.now(),
        });
    };

    const actions = moduleAPI.createActions({
        fetchMidiInputDevices: async (): Promise<MidiDevicesSnapshot> => {
            await ioModule.ensureListening();
            return setMidiInputDevices(ioModule.midiDeviceState.getState().midiInputDevices);
        },
    });

    if (moduleAPI.deps.core.isMaestro()) {
        await actions.fetchMidiInputDevices();

        const subscription = ioModule.midiDeviceStatusSubject.subscribe(device => {
            if (device.subtype !== 'midi_input') {
                return;
            }

            midiDevicesSnapshot.setState(currentSnapshot => {
                const currentInputDevices = uniqueDeviceNames(currentSnapshot.midiInputDevices);
                const deviceName = device.name.trim();
                if (!deviceName) {
                    return currentSnapshot;
                }

                const nextInputDevices = device.status === 'connected'
                    ? uniqueDeviceNames([...currentInputDevices, deviceName])
                    : currentInputDevices.filter(currentDeviceName => currentDeviceName !== deviceName);

                return {
                    midiInputDevices: nextInputDevices,
                    lastUpdatedAt: Date.now(),
                };
            });
        });

        moduleAPI.onDestroy(() => subscription.unsubscribe());
    }

    return {
        midiDevicesSnapshot,
        // Springboard's createActions type wraps async callback return types one level too deep,
        // but JavaScript promise resolution flattens the value seen by callers at runtime.
        actions: actions as unknown as MidiDevicesModuleActions,
    };
});
