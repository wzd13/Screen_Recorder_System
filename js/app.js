import { AudioMixer } from "./audio-mixer.js";
import { StudioRecorder } from "./recorder.js";
import { deleteRecording, listRecordings, saveRecording } from "./storage.js";

const $ = id => document.getElementById(id);
const els = ["screenPreview","cameraPreview","emptyState","stageState","stageTimer","recordingBanner","recordingLabel","recordingTimer","selectScreenButton","startButton","pauseButton","stopButton","micButton","cameraButton","micStatus","cameraStatus","audioMeter","micVolume","systemVolume","micVolumeValue","systemVolumeValue","settingsDialog","settingsButton","settingsShortcut","resolution","frameRate","bitrate","echoCancellation","noiseSuppression","resolutionBadge","fpsBadge","reviewDialog","reviewVideo","reviewDuration","reviewSize","reviewFormat","closeReview","snapshotButton","saveLibraryButton","downloadButton","libraryButton","libraryDrawer","closeLibrary","drawerBackdrop","libraryList","libraryCount","supportStatus","helpButton","renameDialog","renameInput","confirmRename"].reduce((o,id)=>(o[id]=$(id),o),{});
const defaults = { resolution: "720", frameRate: 30, bitrate: 4, echoCancellation: true, noiseSuppression: true, micVolume: 1, systemVolume: 1 };
let settings = { ...defaults, ...JSON.parse(localStorage.getItem("screenRecorderSettings") || "{}") };
let screenStream = null, micStream = null, cameraStream = null, mixer = null, recorder = null, recordingStreamRef = null, lastRecording = null, pendingRename = null, meterFrame = null, compositionFrame = null, reviewUrl = null, cameraDrag = null, state = "idle";

const formatTime = ms => { const seconds = Math.floor(ms / 1000); return `${String(Math.floor(seconds / 60)).padStart(2,"0")}:${String(seconds % 60).padStart(2,"0")}`; };
const notify = (message, type = "") => { const node = document.createElement("div"); node.className = `toast ${type}`; node.textContent = message; $("toastRegion").append(node); setTimeout(() => node.remove(), 4500); };
const setState = next => { state = next; els.stageState.textContent = next === "recording" ? "Recording" : next === "paused" ? "Paused" : next === "processing" ? "Processing…" : screenStream ? "Screen selected" : "No source selected"; els.recordingBanner.classList.toggle("is-hidden", !["recording","paused"].includes(next)); els.recordingLabel.textContent = next === "paused" ? "Paused" : "Recording"; els.startButton.disabled = !screenStream || !["screen-selected","review","idle"].includes(next); els.pauseButton.disabled = !["recording","paused"].includes(next); els.stopButton.disabled = !["recording","paused"].includes(next); };
const persistSettings = () => { localStorage.setItem("screenRecorderSettings", JSON.stringify(settings)); els.resolutionBadge.textContent = settings.resolution === "720" ? "1280 × 720" : settings.resolution === "1080" ? "1920 × 1080" : "3840 × 2160"; els.fpsBadge.textContent = `${settings.frameRate} FPS`; };
function stopTracks(stream) { stream?.getTracks().forEach(track => track.stop()); }
async function waitForVideoFrame(video) {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    await Promise.race([
      new Promise(resolve => video.addEventListener("loadeddata", resolve, { once: true })),
      new Promise(resolve => setTimeout(resolve, 1500))
    ]);
  }
  if (video.requestVideoFrameCallback) await new Promise(resolve => video.requestVideoFrameCallback(() => resolve()));
  else await new Promise(resolve => requestAnimationFrame(resolve));
}

async function selectScreen() {
  if (!navigator.mediaDevices?.getDisplayMedia) { notify("Screen capture is not supported in this browser.", "error"); return; }
  try {
    stopTracks(screenStream); screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: settings.frameRate }, audio: true });
    els.screenPreview.srcObject = screenStream; els.screenPreview.style.display = "block"; els.emptyState.classList.add("is-hidden"); await els.screenPreview.play(); await waitForVideoFrame(els.screenPreview);
    screenStream.getVideoTracks()[0].addEventListener("ended", () => { if (state === "recording" || state === "paused") recorder?.stop(); stopTracks(screenStream); screenStream = null; els.screenPreview.srcObject = null; els.screenPreview.style.display = "none"; els.emptyState.classList.remove("is-hidden"); setState("idle"); notify("Screen sharing ended."); });
    setState("screen-selected"); notify("Screen capture ready.", "success");
  } catch (error) { if (error.name !== "NotAllowedError") notify(`Could not capture screen: ${error.message}`, "error"); else notify("Screen capture permission was cancelled.", "error"); }
}
async function toggleMic() {
  if (micStream) { stopTracks(micStream); micStream = null; els.micButton.classList.remove("active"); els.micStatus.textContent = "Not connected"; notify("Microphone disabled."); return; }
  try { micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: settings.echoCancellation, noiseSuppression: settings.noiseSuppression } }); els.micButton.classList.add("active"); els.micStatus.textContent = "Ready"; notify("Microphone enabled.", "success"); } catch (error) { notify("Microphone permission was denied or unavailable.", "error"); }
}
async function toggleCamera() {
  if (cameraStream) { stopTracks(cameraStream); cameraStream = null; els.cameraPreview.srcObject = null; els.cameraPreview.classList.add("is-hidden"); $("cameraClose").classList.add("is-hidden"); els.cameraButton.classList.remove("active"); els.cameraStatus.textContent = "Off"; notify("Webcam disabled."); return; }
  try { cameraStream = await navigator.mediaDevices.getUserMedia({ video: true }); els.cameraPreview.srcObject = cameraStream; els.cameraPreview.classList.remove("is-hidden"); $("cameraClose").classList.remove("is-hidden"); els.cameraButton.classList.add("active"); els.cameraStatus.textContent = "Ready"; notify("Webcam enabled.", "success"); } catch (error) { notify("Webcam permission was denied or unavailable.", "error"); }
}
function recordingStream() {
  let videoStream = new MediaStream(screenStream.getVideoTracks());
  if (cameraStream) {
    const canvas = document.createElement("canvas");
    const dimensions = settings.resolution === "720" ? [1280, 720] : settings.resolution === "1080" ? [1920, 1080] : [3840, 2160];
    canvas.width = dimensions[0]; canvas.height = dimensions[1];
    const context = canvas.getContext("2d");
    const draw = () => {
      context.drawImage(els.screenPreview, 0, 0, canvas.width, canvas.height);
      const cameraWidth = Math.round(canvas.width * .25);
      const cameraHeight = Math.round(cameraWidth * .75);
      context.drawImage(els.cameraPreview, canvas.width - cameraWidth - 28, canvas.height - cameraHeight - 28, cameraWidth, cameraHeight);
      compositionFrame = requestAnimationFrame(draw);
    };
    draw();
    videoStream = canvas.captureStream(settings.frameRate);
  }
  const stream = new MediaStream(videoStream.getVideoTracks());
  if (!micStream && !screenStream.getAudioTracks().length) return Promise.resolve(stream);
  mixer = new AudioMixer({ micVolume: settings.micVolume, systemVolume: settings.systemVolume });
  return mixer.connect(micStream, screenStream).then(audio => {
    audio.getAudioTracks().forEach(track => stream.addTrack(track));
    if (!stream.getAudioTracks().length) throw new Error("The selected microphone or system audio did not provide an audio track.");
    return stream;
  });
}
async function startRecording() {
  if (!screenStream || !["screen-selected","idle","review"].includes(state)) return;
  try { recordingStreamRef = await recordingStream(); recorder = new StudioRecorder({ onTime: ms => { els.stageTimer.textContent = formatTime(ms); els.recordingTimer.textContent = formatTime(ms); }, onState: (next, error) => { if (next === "error") { stopTracks(recordingStreamRef); recordingStreamRef = null; mixer?.close(); setState("screen-selected"); notify(error.message, "error"); return; } setState(next); }, onData: completeRecording }); recorder.start(recordingStreamRef, settings.bitrate); notify(recordingStreamRef.getAudioTracks().length ? "Recording started with microphone/system audio." : "Recording started without audio.", "success"); } catch (error) { stopTracks(recordingStreamRef); recordingStreamRef = null; mixer?.close(); notify(error.message, "error"); setState("screen-selected"); }
}
const extensionFor = mimeType => mimeType.includes("mp4") ? "mp4" : mimeType.includes("ogg") ? "ogv" : "webm";
function showReview(blob, duration, mimeType) {
  if (reviewUrl) URL.revokeObjectURL(reviewUrl);
  reviewUrl = URL.createObjectURL(blob);
  els.reviewVideo.onerror = () => notify("This browser could not decode the WebM preview. The recording is WebM/Opus; use Chrome, Edge, or VLC for playback.", "error");
  els.reviewVideo.src = reviewUrl;
  els.reviewVideo.load();
  els.reviewDuration.textContent = formatTime(duration);
  els.reviewSize.textContent = `${(blob.size / 1048576).toFixed(1)} MB`;
  els.reviewFormat.textContent = mimeType.split(";")[0].replace("video/","").toUpperCase();
}
function completeRecording(blob, duration, mimeType) { cancelAnimationFrame(compositionFrame); stopTracks(recordingStreamRef); recordingStreamRef = null; lastRecording = { blob, duration, mimeType, createdAt: Date.now(), title: `Screen recording — ${new Date().toLocaleString()}` }; stopTracks(micStream); micStream = null; els.micButton.classList.remove("active"); els.micStatus.textContent = "Not connected"; mixer?.close(); setState("review"); showReview(blob, duration, mimeType); els.reviewDialog.showModal(); notify("Recording completed.", "success"); }
function download(blob, name) { if (!blob?.size) { notify("The recording is empty and cannot be downloaded.", "error"); return; } const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); notify("Downloaded WebM/Opus video. Use Chrome, Edge, or VLC if another player cannot open it.", "success"); }
async function renderLibrary() { const recordings = await listRecordings(); els.libraryCount.textContent = recordings.length; els.libraryList.replaceChildren(); if (!recordings.length) { const empty = document.createElement("p"); empty.className = "empty-library"; empty.textContent = "No saved recordings yet. Your local captures will appear here."; els.libraryList.append(empty); return; } recordings.forEach(recording => { const item = document.createElement("article"); item.className = "library-item"; const image = document.createElement("img"); image.alt = "Recording thumbnail"; image.src = recording.thumbnail || ""; const body = document.createElement("div"); const title = document.createElement("h3"); title.textContent = recording.title; const meta = document.createElement("p"); meta.textContent = `${formatTime(recording.duration)} · ${(recording.blob.size / 1048576).toFixed(1)} MB`; const play = document.createElement("button"); play.textContent = "Preview"; play.onclick = () => { showReview(recording.blob, recording.duration, recording.mimeType); els.reviewDialog.showModal(); }; const rename = document.createElement("button"); rename.textContent = "Rename"; rename.onclick = () => { pendingRename = recording; els.renameInput.value = recording.title; els.renameDialog.showModal(); els.renameInput.focus(); }; const save = document.createElement("button"); save.textContent = "Download"; save.onclick = () => download(recording.blob, `${recording.title.replace(/[^\w -]/g,"")}.${extensionFor(recording.mimeType)}`); const remove = document.createElement("button"); remove.textContent = "Delete"; remove.onclick = async () => { if (confirm("Delete this local recording?")) { await deleteRecording(recording.id); renderLibrary(); notify("Recording deleted."); } }; body.append(title, meta, play, rename, save, remove); item.append(image, body); els.libraryList.append(item); }); }
function animateMeter() { els.audioMeter.style.width = `${Math.min(100, (mixer?.level() || 0) * 100)}%`; meterFrame = requestAnimationFrame(animateMeter); }
els.selectScreenButton.onclick = selectScreen; els.startButton.onclick = startRecording; els.pauseButton.onclick = () => recorder?.[state === "recording" ? "pause" : "resume"](); els.stopButton.onclick = () => recorder?.stop(); els.micButton.onclick = toggleMic; els.cameraButton.onclick = toggleCamera; $("cameraClose").onclick = toggleCamera;
els.micVolume.oninput = e => { settings.micVolume = Number(e.target.value); els.micVolumeValue.textContent = `${Math.round(settings.micVolume * 100)}%`; mixer?.setVolume("mic", settings.micVolume); }; els.systemVolume.oninput = e => { settings.systemVolume = Number(e.target.value); els.systemVolumeValue.textContent = `${Math.round(settings.systemVolume * 100)}%`; mixer?.setVolume("system", settings.systemVolume); };
els.settingsButton.onclick = els.settingsShortcut.onclick = () => { els.resolution.value = settings.resolution; els.frameRate.value = settings.frameRate; els.bitrate.value = settings.bitrate; els.echoCancellation.checked = settings.echoCancellation; els.noiseSuppression.checked = settings.noiseSuppression; els.settingsDialog.showModal(); };
$("saveSettingsButton").onclick = () => { settings = { ...settings, resolution: els.resolution.value, frameRate: Number(els.frameRate.value), bitrate: Number(els.bitrate.value), echoCancellation: els.echoCancellation.checked, noiseSuppression: els.noiseSuppression.checked }; persistSettings(); notify("Preferences saved.", "success"); };
els.closeReview.onclick = () => els.reviewDialog.close(); els.downloadButton.onclick = () => lastRecording && download(lastRecording.blob, `screen-recording-${new Date().toISOString().slice(0,19).replace(/[:T]/g,"-")}.${extensionFor(lastRecording.mimeType)}`);
els.snapshotButton.onclick = () => { if (!els.reviewVideo.videoWidth) { notify("Wait for the video preview to load before taking a snapshot.", "error"); return; } const canvas = document.createElement("canvas"); canvas.width = els.reviewVideo.videoWidth; canvas.height = els.reviewVideo.videoHeight; canvas.getContext("2d").drawImage(els.reviewVideo, 0, 0); canvas.toBlob(blob => download(blob, `screen-snapshot-${Date.now()}.png`), "image/png"); };
els.saveLibraryButton.onclick = async () => { if (!lastRecording) return; try { await saveRecording({ ...lastRecording, id: crypto.randomUUID() }); notify("Recording saved to your local library.", "success"); renderLibrary(); } catch (error) { notify("Could not save recording. Browser storage may be full.", "error"); } };
els.confirmRename.onclick = async event => { event.preventDefault(); const nextTitle = els.renameInput.value.trim(); if (!pendingRename || !nextTitle) return; try { await saveRecording({ ...pendingRename, title: nextTitle }); pendingRename = null; els.renameDialog.close(); await renderLibrary(); notify("Recording renamed.", "success"); } catch (error) { notify("Could not rename this recording.", "error"); } };
els.libraryButton.onclick = () => { els.libraryDrawer.classList.add("open"); els.drawerBackdrop.classList.add("open"); renderLibrary(); }; els.closeLibrary.onclick = els.drawerBackdrop.onclick = () => { els.libraryDrawer.classList.remove("open"); els.drawerBackdrop.classList.remove("open"); };
els.helpButton.onclick = () => notify("Select a screen, optionally enable mic or webcam, then start recording. Media is processed locally.");
document.addEventListener("keydown", event => { if (event.target.matches("input,textarea,select,[contenteditable]")) return; if (!event.altKey) return; if (event.key.toLowerCase() === "r") { event.preventDefault(); state === "recording" || state === "paused" ? recorder?.stop() : startRecording(); } if (event.key.toLowerCase() === "p") { event.preventDefault(); recorder?.[state === "recording" ? "pause" : "resume"](); } if (event.key.toLowerCase() === "m") { event.preventDefault(); toggleMic(); } if (event.key.toLowerCase() === "w") { event.preventDefault(); toggleCamera(); } });
els.cameraPreview.addEventListener("pointerdown", event => { cameraDrag = { x: event.clientX - els.cameraPreview.offsetLeft, y: event.clientY - els.cameraPreview.offsetTop }; els.cameraPreview.setPointerCapture(event.pointerId); }); els.cameraPreview.addEventListener("pointermove", event => { if (!cameraDrag) return; const rect = $("stage").getBoundingClientRect(); els.cameraPreview.style.left = `${Math.max(0, Math.min(rect.width - els.cameraPreview.offsetWidth, event.clientX - rect.left - cameraDrag.x))}px`; els.cameraPreview.style.top = `${Math.max(0, Math.min(rect.height - els.cameraPreview.offsetHeight, event.clientY - rect.top - cameraDrag.y))}px`; els.cameraPreview.style.right = "auto"; els.cameraPreview.style.bottom = "auto"; }); els.cameraPreview.addEventListener("pointerup", () => { cameraDrag = null; });
persistSettings(); if (navigator.mediaDevices?.getDisplayMedia && window.MediaRecorder) { els.supportStatus.innerHTML = '<span class="dot"></span> Browser ready'; } else { els.supportStatus.innerHTML = '<span class="dot" style="background:#f05267"></span> Limited support'; notify("Use a recent browser over HTTPS or localhost for recording.", "error"); } setState("idle"); animateMeter(); renderLibrary().catch(() => notify("Recording library is unavailable in this browser.", "error")); window.addEventListener("beforeunload", () => { stopTracks(screenStream); stopTracks(micStream); stopTracks(cameraStream); cancelAnimationFrame(meterFrame); if (reviewUrl) URL.revokeObjectURL(reviewUrl); cancelAnimationFrame(meterFrame); mixer?.close(); });
