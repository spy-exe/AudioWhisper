export function CaptureSources({ source, onChange, disabled = false }: {
  source: string; onChange: (source: string) => void; disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled}>
      <legend className="mb-3 text-sm font-semibold">O que você quer gravar?</legend>
      <div className="capture-sources">
        {[
          { value: "microphone", label: "Microfone", description: "Sua voz e o ambiente" },
          { value: "system", label: "Áudio do desktop", description: "O som dos aplicativos" },
          { value: "mixed", label: "Desktop e microfone", description: "A conversa dos dois lados" },
          { value: "obs", label: "OBS / entrada virtual", description: "Uma entrada de áudio dedicada" },
        ].map((option) => (
          <label key={option.value} className="capture-source">
            <input type="radio" name="capture-source" value={option.value}
              checked={source === option.value} onChange={() => onChange(option.value)} />
            <span>
              <span className="block text-sm font-semibold">{option.label}</span>
              <span className="mt-1 block text-xs text-text-muted">{option.description}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
