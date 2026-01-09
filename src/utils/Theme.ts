
/**
 * Theme helper to access CSS variables from JavaScript/TypeScript.
 * Useful for Canvas rendering that requires color values.
 */
export class Theme {
    static getComputedStyle(): CSSStyleDeclaration {
        return getComputedStyle(document.documentElement);
    }

    static getColor(variableName: string, fallback: string = '#79EFA4'): string {
        const value = this.getComputedStyle().getPropertyValue(variableName).trim();
        return value || fallback;
    }

    // Common Colors
    static get mainColor(): string { return this.getColor('--ui-main-color', '#79EFA4'); }
    static get backgroundColor(): string { return this.getColor('--ui-bg-color', '#000000'); }
    static get selectionColor(): string { return this.getColor('--ui-selection-bg', '#79EFA4'); }
    static get selectionTextColor(): string { return this.getColor('--ui-selection-text', '#000000'); }
}
