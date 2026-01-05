export class AudioManager {

    playSound(name: string): void {
        const path = `/sounds/${name}`;

        // Simple HTML5 Audio for now. 
        // For production games we might want WebAudio API for better concurrent playback/mixing, 
        // but for this retro engine HTML5 is decent and simple.

        // Always create new instance to allow overlapping sounds? 
        // Or reuse? Reuse cuts off previous. New instance allows overlap.
        const audio = new Audio(path);

        audio.play().catch(e => {
            console.warn(`[AudioManager] Failed to play sound '${name}':`, e);
        });
    }
}
