import { onMount, onDestroy } from 'svelte';
import { audioStream } from './stores.js';

let websocket;
const CHUNK_SIZE = 4096 * 2; // Adjust based on your needs

onMount(() => {
  websocket = new WebSocket('wss://your-backend-url');
  websocket.onopen = () => console.log('WebSocket connected');
  websocket.onerror = (error) => console.error('WebSocket error:', error);
  websocket.onclose = () => console.log('WebSocket disconnected');
});

onDestroy(() => {
  if (websocket) websocket.close();
});

const unsubscribe = audioStream.subscribe(stream => {
  if (stream.length >= CHUNK_SIZE && websocket && websocket.readyState === WebSocket.OPEN) {
    const audioChunk = stream.slice(0, CHUNK_SIZE);
    websocket.send(audioChunk);
    audioStream.update(s => s.slice(CHUNK_SIZE));
  }
});

onDestroy(unsubscribe);
