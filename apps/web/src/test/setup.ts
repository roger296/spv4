import { expect, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

// jsdom lacks these; Radix primitives call them when mounted.
class ObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): unknown[] {
    return [];
  }
}
if (typeof globalThis.ResizeObserver === 'undefined') (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ObserverStub;
if (typeof globalThis.IntersectionObserver === 'undefined') (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = ObserverStub;
if (typeof Element !== 'undefined') {
  Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture ?? (() => false);
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => undefined);
}

afterEach(() => cleanup());
