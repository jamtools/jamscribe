# JamScribe

Have all your jams recorded, without needing to remember to record! Your own personal scribe for your music.

## Raspberry Pi audio capture

JamScribe records audio on the Linux/maestro machine, not in the browser. Install the ALSA and SoX command-line tools:

```sh
sudo apt-get update
sudo apt-get install -y alsa-utils sox
```

USB interfaces such as the Focusrite Scarlett 2i2 1st generation should appear in:

```sh
arecord -l
```

In JamScribe settings:

- Enable **Record audio with each MIDI session**.
- Select the Scarlett input device. JamScribe lists `plughw:CARD,DEVICE` IDs by default because they are more forgiving than strict `hw:CARD,DEVICE` IDs for sample-rate/format conversion.
- Use **Source Channel Count** `2` for the Scarlett 2i2.
- Use **Channel to Record** `1` for input 1 or `2` for input 2.
- Use `44100` or `48000` Hz unless your ALSA setup requires something else.
- Click **Test audio input** before a session. The test records a short temporary WAV, verifies samples were written, and deletes it.

When the first MIDI event starts a take, JamScribe starts one audio recording for the whole take. When MIDI inactivity stops the take, JamScribe writes/uploads MIDI files and a separate mono WAV named with the same take prefix, requesting separate upload URLs for each file.
