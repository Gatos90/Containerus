import { bootstrapApplication } from "@angular/platform-browser";
import { AppComponent } from "./app/app.component";
import { appConfig } from "./app/app.config";

// Suppress ResizeObserver loop errors - these are benign browser warnings
// that occur when observer callbacks take longer than a frame
const resizeObserverErr = window.onerror;
window.onerror = (message, ...args) => {
  if (typeof message === 'string' && message.includes('ResizeObserver loop')) {
    return true; // Suppress the error
  }
  return resizeObserverErr?.call(window, message, ...args) ?? false;
};

window.addEventListener('error', (event) => {
  if (event.message?.includes('ResizeObserver loop')) {
    event.stopImmediatePropagation();
    event.preventDefault();
  }
});

bootstrapApplication(AppComponent, appConfig).catch((err) =>
  console.error(err),
);
