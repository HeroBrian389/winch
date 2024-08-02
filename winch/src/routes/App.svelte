<script>
import AudioCapture from './AudioCapture.svelte';
import AudioStreamer from './AudioStreamer.svelte';

let isRecording = false;
</script>

<AudioCapture bind:isRecording />
<AudioStreamer />

<button on:click={() => isRecording = !isRecording}>
  {isRecording ? 'Stop Recording' : 'Start Recording'}
</button>