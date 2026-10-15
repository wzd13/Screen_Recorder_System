# Screen Recorder Studio

A local-first, browser-based screen recording studio built with HTML, CSS, vanilla JavaScript, and native Web Media APIs. No server, account, analytics, or upload service is required.

## Features

- Screen, application-window, or browser-tab capture through `getDisplayMedia()`.
- Start, pause, resume, stop, elapsed duration, review, download, and PNG snapshot.
- Optional microphone capture with echo cancellation, noise suppression, gain control, and an audio meter.
- Optional webcam preview with draggable picture-in-picture positioning.
- Web Audio mixing for microphone and system/tab audio when the browser supplies a system audio track.
- Persistent recording library backed by IndexedDB (`ScreenRecorderDB`), including preview, rename, download, and delete.
- Local settings for target resolution, frame rate, bitrate, and audio preferences.
- Responsive dark studio interface, keyboard shortcuts, accessible labels, and toast notifications.

## Technology and structure

```text
index.html
css/
  style.css
  components.css
js/
  app.js             UI state, permissions, controls, review/library wiring
  recorder.js        MediaRecorder lifecycle and duration tracking
  audio-mixer.js     Web Audio routing and level analysis
  storage.js         IndexedDB persistence
```

## Run locally

Media permissions and ES modules should be tested from a secure origin. The easiest option is any static web server:

```text
python -m http.server 8080
```

Then open `http://localhost:8080` in Chrome, Edge, Firefox, or another recent browser. Direct `file://` execution is not recommended and may block modules or media capture.

## Record a session

1. Select **Select screen** and choose an entire screen, application window, or tab in the native browser picker.
2. Optionally enable **Microphone** and/or **Webcam**. The first use asks for the corresponding permission.
3. Adjust audio sliders or open **Recording settings** before recording.
4. Choose **Start recording**, then pause/resume or stop when finished.
5. In the review window, preview the result, download the video, save it to the local library, or capture a still snapshot.

Shortcuts (when a text field is not focused): `Alt+R` start/stop, `Alt+P` pause/resume, `Alt+M` microphone, and `Alt+W` webcam.

## Browser compatibility and limitations

Screen capture, system audio, camera/microphone permissions, canvas constraints, and MediaRecorder codecs vary by browser and operating system. Chrome and Edge generally provide the broadest desktop support. Firefox and Safari may expose fewer source or audio options.

System audio is only available when the selected browser source and platform offer it. The application does not claim to capture all desktop audio. The actual recording format is selected with `MediaRecorder.isTypeSupported()` and is normally WebM with VP8/VP9 video and Opus audio; it is never mislabeled as MP4. Resolution and frame rate are targets: native screen capture settings depend on the source picker and browser. Older MPC-HC builds may not include WebM/Opus codecs; use a current Chrome/Edge browser or VLC, or install a current codec-enabled media player.

When the webcam is enabled, the recording uses a canvas composition of the captured screen and camera overlay. Without a webcam, it records the native captured video stream directly.

## Library, privacy, and storage

Saved recordings and their metadata remain on this device in IndexedDB. They are not uploaded. Browser storage quotas can be reached by large recordings; if a save fails, download the recording first and delete unneeded library items. Clearing site data removes the library.

The app requests screen, microphone, and webcam permissions only after the user activates the relevant control. Media tracks, object URLs, timers, animation frames, and the audio context are cleaned up when no longer needed.

## Troubleshooting

- **Capture is unavailable:** use a recent browser from `localhost` or HTTPS and confirm the page is not in a restrictive iframe.
- **No system audio:** choose a source that offers audio sharing and enable the browser's audio option.
- **Microphone or webcam fails:** check operating-system privacy settings, close applications holding the device, and retry.
- **Preview does not play:** wait for metadata to load; the review window requires a browser-supported WebM codec.
- **Library save fails:** free browser storage, remove old recordings, or download the recording instead.
