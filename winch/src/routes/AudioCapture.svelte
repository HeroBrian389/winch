<script lang="ts">
import { onMount, onDestroy } from 'svelte';
    import { audioStream } from '@/stores/audioStore';

export let isRecording = false;

let audioContext;
let mediaStream;
let processor;

onMount(() => {
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
});

onDestroy(() => {
  stopRecording();
  if (audioContext) {
    audioContext.close();
  }
});

async function startRecording() {
  if (!audioContext) return;

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const source = audioContext.createMediaStreamSource(mediaStream);
    processor = audioContext.createScriptProcessor(4096, 1, 1);

    source.connect(processor);
    processor.connect(audioContext.destination);

    processor.onaudioprocess = (e) => {
      const audioData = e.inputBuffer.getChannelData(0);
      audioStream.update(stream => {
        stream.push(audioData);
        return stream;
      });
    };

    isRecording = true;
  } catch (error) {
    console.error('Error starting audio recording:', error);
  }
}

function stopRecording() {
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
  }
  if (processor) {
    processor.disconnect();
    processor = null;
  }
  isRecording = false;
}
</script>