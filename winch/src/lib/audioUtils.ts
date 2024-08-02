import Groq from 'groq-sdk';
import fs from 'fs';
import { AudioContext, AudioBuffer } from 'web-audio-api';


const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

export async function transcribeAudio(audioBuffer: Buffer) {
  try {
    // Write buffer to temporary file
    const tempFilePath = `/tmp/audio_${Date.now()}.wav`;
    fs.writeFileSync(tempFilePath, audioBuffer);

    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(tempFilePath),
      model: "whisper-large-v3",
      language: "en",
    });

    // Clean up temp file
    fs.unlinkSync(tempFilePath);

    return transcription.text;
  } catch (error) {
    console.error('Transcription error:', error);
    throw error;
  }
}

// Call this function when you have enough non-silent audio to transcribe


export function detectSilence(audioBuffer: AudioBuffer, threshold = 0.01, minDuration = 0.5) {
  const channelData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const silenceStart = -1;
  const silences = [];

  for (let i = 0; i < channelData.length; i++) {
    if (Math.abs(channelData[i]) < threshold) {
      if (silenceStart === -1) silenceStart = i;
    } else if (silenceStart !== -1) {
      const duration = (i - silenceStart) / sampleRate;
      if (duration >= minDuration) {
        silences.push([silenceStart / sampleRate, i / sampleRate]);
      }
      silenceStart = -1;
    }
  }

  return silences;
}

// Use this function to process each incoming chunk
// and concatenate non-silent segments