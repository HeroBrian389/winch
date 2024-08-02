<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Button } from '@/components/ui/button';
	import { Alert, AlertDescription } from '@/components/ui/alert';
    import JSConfetti from 'js-confetti'


	let audioContext;
	let analyser;
	let microphone;
	let javascriptNode;
    let recordingSession = 0;
	let mediaRecorder;
	let isRecording = false;
	let error = null;
	let transcriptions = [];
	let detectedJoke: { text: string; funniness: number } | null = null;
	let playJokeSoundEffect = false;
    let audioStream;
	let soundEffect;





	const SILENCE_THRESHOLD = 0.03; // Adjust based on your needs
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



async function setupAudioContext() {
    if (audioContext) {
        await audioContext.close();
    }
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    javascriptNode = audioContext.createScriptProcessor(2048, 1, 1);

    analyser.smoothingTimeConstant = 0.8;
    analyser.fftSize = 1024;

    javascriptNode.onaudioprocess = processAudio;

    try {
        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        microphone = audioContext.createMediaStreamSource(audioStream);
        microphone.connect(analyser);
        analyser.connect(javascriptNode);
        javascriptNode.connect(audioContext.destination);

        mediaRecorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm' });
        mediaRecorder.ondataavailable = event => {
            audioChunks.push(event.data);
        };
    } catch (err) {
        error = "Could not access microphone: " + err.message;
    }
}

async function startRecording() {
    recordingSession++;
    console.log(`[Session ${recordingSession}] Starting recording`);
    
    await setupAudioContext();
    
    audioChunks = [];
    hasReachedSignificantLevel = false;
    
    if (audioContext.state === 'suspended') {
        await audioContext.resume();
    }
    
    mediaRecorder.start(500);
}

function stopRecording() {
    console.log(`[Session ${recordingSession}] Stopping recording`);
    
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }
    
    if (microphone) {
        microphone.disconnect();
    }
    if (analyser) {
        analyser.disconnect();
    }
    if (javascriptNode) {
        javascriptNode.disconnect();
    }
    
    if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
    }
    
    if (hasReachedSignificantLevel) {
        sendAudioChunk();
    }
    hasReachedSignificantLevel = false;
}

function toggleRecording() {
    if (isRecording) {
        stopRecording();
    } else {
        startRecording();
    }
    isRecording = !isRecording;
}


    function normalizeAudioBuffer(buffer) {
    const channelData = buffer.getChannelData(0);
    const maxAmplitude = Math.max(...channelData.map(Math.abs));
    const scaleFactor = 1 / maxAmplitude;

    const normalizedBuffer = audioContext.createBuffer(
        buffer.numberOfChannels,
        buffer.length,
        buffer.sampleRate
    );

    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const newChannelData = normalizedBuffer.getChannelData(channel);
        const originalChannelData = buffer.getChannelData(channel);

        for (let i = 0; i < buffer.length; i++) {
            newChannelData[i] = originalChannelData[i] * scaleFactor;
        }
    }

    return normalizedBuffer;
}

function audioBufferToBlob(buffer) {
    const numberOfChannels = buffer.numberOfChannels;
    const length = buffer.length * numberOfChannels * 2;
    const audioData = new ArrayBuffer(length);
    const view = new DataView(audioData);
    let offset = 0;
    
    for (let channel = 0; channel < numberOfChannels; channel++) {
        const channelData = buffer.getChannelData(channel);
        for (let i = 0; i < buffer.length; i++) {
            const sample = Math.max(-1, Math.min(1, channelData[i]));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
            offset += 2;
        }
    }

    const blob = new Blob([view], { type: 'audio/wav' });
    return blob;
}


async function sendProcessedAudio(blob) {
    await analyzeWebM(blob);

    const formData = new FormData();
    formData.append('audio', blob, 'processed_recording.wav');

    try {
        const response = await fetch('/api', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error('Server response was not ok.');
        }

        const result = await response.json();
        console.log('Upload successful:', result);
        // Handle the response as needed
    } catch (err) {
        error = "Error uploading processed audio: " + err.message;
    }
}

async function sendAudioChunk() {
    if (audioChunks.length === 0) return;

    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    console.log('Audio Blob created, size:', audioBlob.size, 'type:', audioBlob.type);

    // Add a small delay to ensure the blob is fully written
    await new Promise(resolve => setTimeout(resolve, 100));

    const arrayBuffer = await audioBlob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    console.log('First 20 bytes of the audio blob:', uint8Array.slice(0, 20));

    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');

    try {
        const response = await fetch('/api', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error(`Server response was not ok. Status: ${response.status}`);
        }

        const result = await response.json();
        console.log('Upload successful:', result);

        if (result.success) {
            
            if (result.results.length > 0) {
                transcriptions = result
                    .results
                    .map(r => r.transcription)
                    .filter(t => t.trim().length > 0);

                const joke = result.results.find(r => r.isJoke);

                if (joke) {
                    detectedJoke = {
                        text: joke.transcription,
                        funniness: joke.funniness
                    };
                    playJokeSoundEffect = true;
                }

                console.log('Transcriptions:', transcriptions);
                console.log('Detected Joke:', detectedJoke);

                if (playJokeSoundEffect) {
                    const jsConfetti = new JSConfetti()
                    jsConfetti.addConfetti()
                    playSound();
                }

                // Clear the transcriptions after a few seconds
                playJokeSoundEffect = false;
            }
        }
        // Handle the response as needed
    } catch (err) {
        error = "Error uploading audio: " + err.message;
        console.error(error);
    }

    // Clear the audioChunks array for the next set of chunks
    audioChunks = [];

    // clear the silenceStart and hasReachedSignificantLevel flags
    silenceStart = null;
    hasReachedSignificantLevel = false;

    // remove all existing data
}



    async function preprocessAndSendAudioChunk() {
    if (audioChunks.length === 0) return;

    // Step 1: Concatenate all audio chunks
    const blob = new Blob(audioChunks, { type: 'audio/webm' });

    // Step 2: Convert blob to ArrayBuffer
    const arrayBuffer = await blob.arrayBuffer();

    // Step 3: Create AudioBuffer from ArrayBuffer
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // Step 4: Process the AudioBuffer (e.g., normalize volume)
    const processedBuffer = normalizeAudioBuffer(audioBuffer);

    // Step 5: Convert processed AudioBuffer back to Blob
    const processedBlob = audioBufferToBlob(processedBuffer);

    // Step 6: Send the processed audio
    await sendProcessedAudio(processedBlob);

    // Clear the audioChunks array for the next set of chunks
    audioChunks = [];
}



	function processAudio(e) {
    const array = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(array);
    const values = array.reduce((a, b) => a + b, 0) / array.length;
    const volume = values / 128.0; // 0 to 1

    if (volume >= SIGNIFICANT_AUDIO_THRESHOLD) {
        hasReachedSignificantLevel = true;
    }

    if (hasReachedSignificantLevel) {
        if (volume < SILENCE_THRESHOLD) {
            if (silenceStart === null) {
                silenceStart = Date.now();
            } else if (Date.now() - silenceStart > SILENCE_DURATION) {
                stopRecording();
                silenceStart = null;
                hasReachedSignificantLevel = false; // Reset for the next chunk

                // delay
                setTimeout(() => {
                    console.log('cool')
                }, 1000);
                startRecording();
            }
        } else {
            silenceStart = null;
        }
    }
}






async function analyzeWebM(blob) {
     const arrayBuffer = await blob.arrayBuffer();
     const dataView = new DataView(arrayBuffer);
     
     console.log('File size:', blob.size, 'bytes');
     console.log('First 50 bytes:', Array.from(new Uint8Array(arrayBuffer.slice(0, 50))).map(b => b.toString(16).padStart(2, '0')).join(' '));
     
     // Check for EBML header
     if (dataView.getUint32(0) === 0x1A45DFA3) {
       console.log('EBML header found');
     } else {
       console.log('EBML header not found');
     }
     
     // Add more checks for other important WebM elements
   }




async function validateWebM(blob) {
    const arrayBuffer = await blob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    console.log('First 20 bytes of the file:', uint8Array.slice(0, 20));

    // Check for EBML header
    const ebmlHeader = [0x1A, 0x45, 0xDF, 0xA3];
    let isEBML = true;
    for (let i = 0; i < ebmlHeader.length; i++) {
        if (uint8Array[i] !== ebmlHeader[i]) {
            isEBML = false;
            break;
        }
    }

    if (!isEBML) {
        console.log('EBML header not found, checking for alternative WebM structures...');
        
        // Check for common WebM elements
        const webmElements = [
            [0x42, 0x82], // DocType
            [0x18, 0x53, 0x80, 0x67], // Segment
            [0x16, 0x54, 0xAE, 0x6B]  // Tracks
        ];

        for (const element of webmElements) {
            const index = uint8Array.findIndex((byte, i) => 
                element.every((elementByte, j) => uint8Array[i + j] === elementByte)
            );
            if (index !== -1) {
                console.log(`Found WebM element at index ${index}`);
                return true;
            }
        }

        console.error('No valid WebM structure found');
        return false;
    }

    console.log('Valid EBML header found');
    return true;
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
