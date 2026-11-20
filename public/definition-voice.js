export class DefinitionVoiceClient {
  constructor({ onState, onProposal, onClear, onStatus, onTranscript, onError, onLanguageError, onClose }) {
    Object.assign(this, { onState, onProposal, onClear, onStatus, onTranscript, onError, onLanguageError, onClose });
    this.socket = null;
    this.audioContext = null;
    this.microphone = null;
    this.camera = null;
    this.cameraTimer = null;
    this.preview = null;
    this.captureNode = null;
    this.playbackSources = new Set();
    this.playbackTime = 0;
    this.muted = false;
    this.intentionalStop = false;
  }

  get active() { return this.socket?.readyState === WebSocket.CONNECTING || this.socket?.readyState === WebSocket.OPEN; }

  async prepareAudio() {
    this.audioContext = new AudioContext();
    await this.audioContext.resume();
    try {
      this.microphone = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true }, video: false,
      });
      await this.audioContext.audioWorklet.addModule('/audio-worklet.js');
      const source = this.audioContext.createMediaStreamSource(this.microphone);
      this.captureNode = new AudioWorkletNode(this.audioContext, 'pcm16-capture');
      this.captureNode.port.onmessage = (event) => {
        if (this.muted || this.socket?.readyState !== WebSocket.OPEN || !event.data || this.socket.bufferedAmount > 1_000_000) return;
        const audio = new Uint8Array(event.data);
        const packet = new Uint8Array(audio.length + 1);
        packet[0] = 1; packet.set(audio, 1);
        this.socket.send(packet);
      };
      source.connect(this.captureNode);
      this.captureNode.connect(this.audioContext.destination);
    } catch (error) {
      this.microphone?.getTracks().forEach((track) => track.stop());
      this.microphone = null;
      this.onError(`Microphone unavailable: ${error.message}. You can type your response instead.`);
    }
  }

    connect(sessionId, language = 'en') {
      this.intentionalStop = false;
      const url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/definition-ws?sessionId=${encodeURIComponent(sessionId)}&language=${encodeURIComponent(language)}`;
      this.socket = new WebSocket(url);
      this.onStatus('Connecting to Gemini Live…');
      this.socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'state') this.onState(message.assessment, message.question, message.questionnaire);
        else if (message.type === 'language_error') this.onLanguageError(message.message);
        else if (message.type === 'proposal') this.onProposal(message);
        else if (message.type === 'proposal_cleared') this.onClear();
        else if (message.type === 'audio') this.playPcm(message.data);
        else if (message.type === 'audio_interrupt') this.stopPlayback();
        else if (message.type === 'transcript') this.onTranscript(message.speaker, message.text, message.messageId);
        else if (message.type === 'live_status') {
          if (message.status === 'connected') this.onStatus('Voice conversation connected.');
          else if (message.status === 'reconnecting') this.onStatus('Reconnecting to Gemini Live…');
          else if (message.detail) this.onError(message.detail);
        } else if (message.type === 'error') this.onError(message.message);
      };
      this.socket.onerror = () => this.onError('Voice connection error.');
      this.socket.onclose = () => {
        this.stopMedia();
        if (!this.intentionalStop) this.onClose();
      };
    }

    send(message) {
      if (this.socket?.readyState !== WebSocket.OPEN) throw new Error('Voice conversation is still connecting.');
      this.socket.send(JSON.stringify(message));
    }

    mute() {
      this.muted = !this.muted;
      return this.muted;
    }
  async toggleCamera(preview) {
      if (this.camera) { this.stopCamera(); return false; }
      if (!this.active) throw new Error('Start a voice conversation first.');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360, frameRate: 1 }, audio: false });
      if (!this.active) { stream.getTracks().forEach((track) => track.stop()); throw new Error('Voice conversation ended.'); }
      this.camera = stream;
      this.preview = preview;
      preview.srcObject = stream;
      preview.style.display = 'block';
      const canvas = document.createElement('canvas');
      canvas.width = 640; canvas.height = 360;
      this.cameraTimer = setInterval(() => {
        if (!this.camera || this.socket?.readyState !== WebSocket.OPEN || preview.readyState < 2 || this.socket.bufferedAmount > 1_000_000) return;
        canvas.getContext('2d').drawImage(preview, 0, 0, 640, 360);
        canvas.toBlob(async (blob) => {
          if (!blob || !this.camera || this.socket?.readyState !== WebSocket.OPEN) return;
          const bytes = new Uint8Array(await blob.arrayBuffer());
          if (bytes.length > 290_000) return;
          const packet = new Uint8Array(bytes.length + 1);
          packet[0] = 2; packet.set(bytes, 1); this.socket.send(packet);
        }, 'image/jpeg', 0.55);
      }, 1100);
      return true;
    }
    stopCamera() {
      clearInterval(this.cameraTimer);
      this.cameraTimer = null;
      this.camera?.getTracks().forEach((track) => track.stop());
      this.camera = null;
      if (this.preview) { this.preview.srcObject = null; this.preview.style.display = 'none'; }
      this.preview = null;
    }

    playPcm(base64) {
      if (!this.audioContext) return;
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const count = Math.floor(bytes.length / 2);
      if (!count) return;
      const samples = new DataView(bytes.buffer);
      const buffer = this.audioContext.createBuffer(1, count, 24000);
      const output = buffer.getChannelData(0);
      for (let index = 0; index < count; index++) output[index] = samples.getInt16(index * 2, true) / 32768;
      const source = this.audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(this.audioContext.destination);
      source.onended = () => this.playbackSources.delete(source);
      this.playbackSources.add(source);
      this.playbackTime = Math.max(this.playbackTime, this.audioContext.currentTime + 0.06);
      source.start(this.playbackTime);
      this.playbackTime += buffer.duration;
    }

    stopPlayback() {
      for (const source of this.playbackSources) { try { source.stop(); } catch { } }
      this.playbackSources.clear();
      this.playbackTime = 0;
    }

    stopMedia() {
      this.stopCamera();
      this.microphone?.getTracks().forEach((track) => track.stop());
      this.microphone = null;
      this.captureNode?.disconnect();
      this.captureNode = null;
      this.stopPlayback();
      this.audioContext?.close().catch(() => { });
      this.audioContext = null;
    }

    stop() {
      this.intentionalStop = true;
      this.socket?.close();
      this.stopMedia();
    }
  }
