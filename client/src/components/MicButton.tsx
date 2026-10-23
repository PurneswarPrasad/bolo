import { useCallback, useEffect, useRef, useState } from "react";
import { transcribeAudio } from "../api/client";

interface MicButtonProps {
  disabled?: boolean;
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
  onStateChange?: (state: "idle" | "recording" | "transcribing") => void;
}

export function MicButton({
  disabled,
  onTranscript,
  onError,
  onStateChange,
}: MicButtonProps) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const setState = useCallback(
    (state: "idle" | "recording" | "transcribing") => {
      onStateChange?.(state);
    },
    [onStateChange]
  );

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const startRecording = async () => {
    if (disabled || recording || transcribing) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stopStream();
        const blob = new Blob(chunksRef.current, { type: mimeType });

        if (blob.size === 0) {
          onError("Empty recording — try again");
          setRecording(false);
          setState("idle");
          return;
        }

        setTranscribing(true);
        setState("transcribing");

        try {
          const result = await transcribeAudio(blob);
          onTranscript(result.transcript);
        } catch (err) {
          onError(err instanceof Error ? err.message : "Transcription failed");
        } finally {
          setTranscribing(false);
          setRecording(false);
          setState("idle");
        }
      };

      recorder.start();
      setRecording(true);
      setState("recording");
    } catch {
      onError("Microphone permission denied");
      setState("idle");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  };

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      stopStream();
    };
  }, []);

  const handlePointerDown = () => startRecording();
  const handlePointerUp = () => {
    if (recording) stopRecording();
  };

  const isBusy = recording || transcribing;
  const label = recording
    ? "Listening..."
    : transcribing
      ? "Transcribing..."
      : "Hold to speak";

  return (
    <>
      <button
        type="button"
        className={`mic-button${recording ? " recording" : ""}`}
        disabled={disabled || transcribing}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        aria-label="Hold to speak"
      >
        🎙️
      </button>
      <span className="mic-hint">{isBusy ? label : "Hold to speak"}</span>
    </>
  );
}
