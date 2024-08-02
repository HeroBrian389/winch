<script>
  import { onMount, onDestroy } from 'svelte';
  import { Button } from '@/components/ui/button';
  import { Alert, AlertDescription } from '@/components/ui/alert';

  let mediaRecorder;
  let audioChunks = [];
  let isRecording = false;
  let error = null;

  onMount(() => {
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = event => {
          audioChunks.push(event.data);
        };
        mediaRecorder.onstop = sendAudioChunks;
      })
      .catch(err => {
        error = "Could not access microphone: " + err.message;
      });
  });

  onDestroy(() => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
  });

  function toggleRecording() {
    if (isRecording) {
      mediaRecorder.stop();
    } else {
      audioChunks = [];
      mediaRecorder.start(1000); // Collect a chunk every 1000ms (1 second)
    }
    isRecording = !isRecording;
  }

  async function sendAudioChunks() {
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');

    try {
      const response = await fetch('/api', {
        method: 'POST',
        body: formData,
        // Do not set Content-Type header manually
      });

      if (!response.ok) {
        throw new Error('Server response was not ok.');
      }

      const result = await response.json();
      console.log('Upload successful:', result);
    } catch (err) {
      error = "Error uploading audio: " + err.message;
    }
  }

</script>

<main class="container mx-auto p-4">
  <h1 class="text-2xl font-bold mb-4">Simple Audio Recorder</h1>
  
  <Button on:click={toggleRecording} class="mb-4">
    {isRecording ? 'Stop Recording' : 'Start Recording'}
  </Button>

  {#if error}
    <Alert variant="destructive">
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  {/if}

  {#if isRecording}
    <p class="mt-4">Recording in progress...</p>
  {/if}
</main>