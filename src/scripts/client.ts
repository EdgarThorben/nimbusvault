import { actions, isInputError } from "astro:actions";

/** Shrinks a camera photo on the phone before upload (keeps uploads small and fast). */
export async function shrinkPhoto(file: File, maxSide = 1600): Promise<File> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/jpeg", 0.82),
    );
    return new File([blob], "photo.jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

/**
 * Voice note → text with the browser's speech recognition (Chrome on Android, Safari on iOS).
 * Where it's missing, the button still works: it focuses the field so Leo can use the
 * keyboard's microphone key instead.
 */
export function attachDictation(opts: {
  button: HTMLButtonElement;
  target: HTMLTextAreaElement;
  label?: HTMLElement | null;
  idleText: string;
  onStop?: (text: string) => void;
}) {
  const { button, target, label, idleText, onStop } = opts;
  const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
  if (!SR) {
    button.addEventListener("click", () => {
      target.focus();
      if (label) label.textContent = "Tap the microphone key on your keyboard to dictate";
    });
    return;
  }

  const rec = new SR();
  rec.lang = navigator.language || "en-GB";
  rec.continuous = true;
  rec.interimResults = false;
  let on = false;
  let heard = "";

  const setOn = (v: boolean) => {
    on = v;
    button.classList.toggle("on", v);
    button.setAttribute("aria-pressed", String(v));
    if (label) label.textContent = v ? "Listening… tap to stop" : idleText;
  };
  rec.onresult = (e: any) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (!e.results[i].isFinal) continue;
      const text = e.results[i][0].transcript.trim();
      if (!text) continue;
      const sentence = text.charAt(0).toUpperCase() + text.slice(1) + (/[.!?]$/.test(text) ? "" : ".");
      const sep = target.value && !/\s$/.test(target.value) ? " " : "";
      target.value += sep + sentence;
      heard += " " + sentence;
      target.dispatchEvent(new Event("input", { bubbles: true }));
    }
  };
  rec.onend = () => {
    setOn(false);
    if (heard.trim()) onStop?.(heard.trim());
    heard = "";
  };
  rec.onerror = (e: any) => {
    setOn(false);
    if (label && e?.error === "not-allowed") label.textContent = "Microphone blocked. Allow it in the browser settings.";
  };
  button.addEventListener("click", () => {
    if (on) rec.stop();
    else {
      try {
        rec.start();
        setOn(true);
      } catch {
        /* already running */
      }
    }
  });
}

/**
 * Submits Astro action forms with fetch so a validation error keeps everything Leo typed.
 * Without JavaScript the forms still post normally. On success: `data-success` URL
 * (":id" is replaced by the result's id), otherwise reload.
 */
export function enhanceForms(root: ParentNode = document) {
  root.querySelectorAll<HTMLFormElement>("form[data-enhance]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      const name = new URL(form.action, location.href).searchParams.get("_action");
      const action = name ? (actions as Record<string, any>)[name] : null;
      if (!action) return;
      event.preventDefault();

      const submitter = (event as SubmitEvent).submitter as HTMLButtonElement | null;
      const buttons = form.querySelectorAll<HTMLButtonElement>('button[type="submit"]');
      buttons.forEach((b) => (b.disabled = true));
      const original = submitter?.textContent;
      if (submitter) submitter.textContent = "Saving…";

      const { data, error } = await action(new FormData(form, submitter));

      buttons.forEach((b) => (b.disabled = false));
      if (submitter && original) submitter.textContent = original;
      if (error) {
        const message = isInputError(error)
          ? Object.values(error.fields).flat()[0] ?? error.message
          : error.message;
        showError(form, String(message));
        return;
      }
      const success = form.dataset.success;
      if (success) location.href = success.replace(":id", data?.id ?? "");
      else location.reload();
    });
  });
}

export function showError(form: HTMLElement, message: string) {
  let box = form.querySelector<HTMLElement>(":scope > [data-form-error]");
  if (!box) {
    box = document.createElement("p");
    box.className = "error";
    box.setAttribute("role", "alert");
    box.dataset.formError = "";
    form.prepend(box);
  }
  box.textContent = message;
  box.scrollIntoView({ block: "center", behavior: "smooth" });
}
