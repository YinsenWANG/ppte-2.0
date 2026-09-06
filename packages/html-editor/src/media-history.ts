/** Session-only interning. Tokens never enter the live DOM or serialized file. */
export class MediaHistory {
    private values = new Map<string, string>();
    private keys = new Map<string, string>();
    private next = 0;
    private prefix = `ppte-history-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}:`;
    private pattern = new RegExp(this.prefix + "\\d+", "g");
    compact(html: string) {
        return html.replace(/data:(?:image|video|audio)\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, value => {
            let key = this.keys.get(value);
            if (!key) { key = `${this.prefix}${++this.next}`; this.keys.set(value, key); this.values.set(key, value); }
            return key;
        });
    }
    expand(html: string) {
        return html.replace(this.pattern, key => {
            const value = this.values.get(key);
            if (!value) throw Error('MEDIA_HISTORY_RESOURCE_MISSING');
            return value;
        });
    }
    retain(html: string) {
        const used = new Set(html.match(this.pattern));
        for (const [key, value] of this.values) if (!used.has(key)) { this.values.delete(key); this.keys.delete(value); }
    }
    get stats() { return { resources: this.values.size, estimatedStringBytes: [...this.values.values()].reduce((n, s) => n + s.length * 2, 0) }; }
}
