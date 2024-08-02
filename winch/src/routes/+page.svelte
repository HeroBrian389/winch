<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Button } from '@/components/ui/button';
	import { Alert, AlertDescription } from '@/components/ui/alert';

	let audioContext;
	let analyser;
	let microphone;
	let javascriptNode;
	let mediaRecorder;
	let isRecording = false;
	let error = null;
	let transcriptions = [];
	let detectedJoke: { text: string; funniness: number } | null = null;
    let playJokeSoundEffect = false;
    let soundEffect;

	const SILENCE_THRESHOLD = 0.01; // Adjust based on your needs
	const SILENCE_DURATION = 1000; // milliseconds
	const SIGNIFICANT_AUDIO_THRESHOLD = 0.1; // Adjust based on your needs
	let silenceStart = null;
	let audioChunks = [];
	let hasReachedSignificantLevel = false;

	onMount(() => {
		setupAudioContext();
        soundEffect = new Audio('/sound/wow.mp3');
	});

	onDestroy(() => {
		if (audioContext) {
			audioContext.close();
		}
	});

	function setupAudioContext() {
		audioContext = new (window.AudioContext || window.webkitAudioContext)();
		analyser = audioContext.createAnalyser();
		javascriptNode = audioContext.createScriptProcessor(2048, 1, 1);

		analyser.smoothingTimeConstant = 0.8;
		analyser.fftSize = 1024;

		javascriptNode.onaudioprocess = processAudio;

		navigator.mediaDevices
			.getUserMedia({ audio: true })
			.then((stream) => {
				microphone = audioContext.createMediaStreamSource(stream);
				microphone.connect(analyser);
				analyser.connect(javascriptNode);
				javascriptNode.connect(audioContext.destination);

				mediaRecorder = new MediaRecorder(stream);
				mediaRecorder.ondataavailable = (event) => {
					audioChunks.push(event.data);
				};
			})
			.catch((err) => {
				error = 'Could not access microphone: ' + err.message;
			});
	}

	function processAudio(e) {
		const array = new Uint8Array(analyser.frequencyBinCount);
		analyser.getByteFrequencyData(array);
		const values = array.reduce((a, b) => a + b, 0) / array.length;
		const volume = values / 128.0; // 0 to 1

        if (volume >= SIGNIFICANT_AUDIO_THRESHOLD && !hasReachedSignificantLevel) {
            console.log('wut')
            audioChunks = []
        }


		if (volume >= SIGNIFICANT_AUDIO_THRESHOLD) {
			hasReachedSignificantLevel = true;
		}

		if (hasReachedSignificantLevel) {
			if (volume < SILENCE_THRESHOLD) {
				if (silenceStart === null) {
					silenceStart = Date.now();
				} else if (Date.now() - silenceStart > SILENCE_DURATION) {
					sendAudioChunk();
					silenceStart = null;
					hasReachedSignificantLevel = false; // Reset for the next chunk
				}
			} else {
				silenceStart = null;
			}
		}
	}

	function toggleRecording() {
		if (isRecording) {
			stopRecording();
		} else {
			startRecording();
		}
		isRecording = !isRecording;
	}

	function startRecording() {
		audioChunks = [];
		hasReachedSignificantLevel = false;
		if (mediaRecorder) {
			mediaRecorder.stop();
			microphone.disconnect();
			analyser.disconnect();
			javascriptNode.disconnect();
		}
		setupAudioContext(); // Re-setup the audio context
		mediaRecorder.start(10); // Collect data every 10ms
	}

	function stopRecording() {
		mediaRecorder.stop();
		if (hasReachedSignificantLevel) {
			sendAudioChunk(); // Send any remaining audio if it reached significant level
		}
		hasReachedSignificantLevel = false;
	}

    
    
async function sendAudioChunk() {
    if (audioChunks.length === 0) return;

    try {
        
        // Combine all chunks into a single Blob
        const combinedBlob = new Blob(audioChunks, { type: 'audio/webm; codecs=opus' });
        console.log(`Combined blob size: ${combinedBlob.size} bytes`);

        const formData = new FormData();
        formData.append('audio', combinedBlob, 'recording.webm');

        const response = await fetch('/api', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error(`Server response was not ok. Status: ${response.status}`);
        }

        const result = await response.json();
        console.log('Upload successful:', result);
        // ... (rest of the function remains the same)
    } catch (err) {
        console.error('Error in sendAudioChunk:', err);
        error = 'Error uploading audio: ' + err.message;
    }

    audioChunks = []; // Clear the chunks for the next recording
}
async function formatWebMChunks(chunks) {
    const combinedBlob = new Blob(chunks, { type: 'audio/webm' });
    const arrayBuffer = await combinedBlob.arrayBuffer();

    if (isValidWebMHeader(arrayBuffer)) {
        return combinedBlob; // If we already have a valid header, return the blob as is
    }

    // If we don't have a valid header, we need to create one
    const header = createWebMHeader();
    const headerArrayBuffer = await header.arrayBuffer();

    const newArrayBuffer = new ArrayBuffer(headerArrayBuffer.byteLength + arrayBuffer.byteLength);
    new Uint8Array(newArrayBuffer).set(new Uint8Array(headerArrayBuffer), 0);
    new Uint8Array(newArrayBuffer).set(new Uint8Array(arrayBuffer), headerArrayBuffer.byteLength);

    return new Blob([newArrayBuffer], { type: 'audio/webm' });
}

function isValidWebMHeader(arrayBuffer) {
    const header = new Uint8Array(arrayBuffer.slice(0, 4));
    return header[0] === 0x1A && header[1] === 0x45 && header[2] === 0xDF && header[3] === 0xA3;
}

function createWebMHeader() {
    // Basic WebM header structure
    const header = new Uint8Array([
        0x1A, 0x45, 0xDF, 0xA3, // EBML
        0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1F, // EBML size (31 bytes)
        0x42, 0x86, 0x81, 0x01, // EBMLVersion = 1
        0x42, 0xF7, 0x81, 0x01, // EBMLReadVersion = 1
        0x42, 0xF2, 0x81, 0x04, // EBMLMaxIDLength = 4
        0x42, 0xF3, 0x81, 0x08, // EBMLMaxSizeLength = 8
        0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6D, // DocType = "webm"
        0x42, 0x87, 0x81, 0x02, // DocTypeVersion = 2
        0x42, 0x85, 0x81, 0x02  // DocTypeReadVersion = 2
    ]);

    return new Blob([header], { type: 'audio/webm' });
}



  function playSound() {
    soundEffect.play();
  }

</script>

<main class="container mx-auto p-4">
	<h1 class="mb-4 text-2xl font-bold">Real-time Audio Recorder</h1>

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

	{#if transcriptions.length > 0}
		<h2 class="mb-2 mt-4 text-xl font-bold">Transcriptions:</h2>
		<ul class="list-disc pl-5">
			{#each transcriptions as transcription}
				<li>{transcription}</li>
			{/each}
		</ul>
	{/if}

	{#if detectedJoke}
		<h2 class="mb-2 mt-4 text-xl font-bold">Detected Joke:</h2>
		<div class="pl-5">
			<p><strong>Joke:</strong> {detectedJoke.text}</p>
			<p><strong>Funniness Rating:</strong> {detectedJoke.funniness}/10</p>
		</div>
	{/if}
</main>
