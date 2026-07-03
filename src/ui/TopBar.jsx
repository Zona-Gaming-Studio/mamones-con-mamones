import "./TopBar.css";

// Icono SVG inline (trazo de Feather/Lucide, MIT).
const IcoAtras = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

// Barra superior del prototipo: full-width, pegada arriba (respeta el notch),
// con botón atrás + eyebrow y título centrados. `narrow` alinea el contenido
// con paneles de 440px (lobby); por defecto usa 560px (menú).
export default function TopBar({ onBack, backLabel, eyebrow, title, narrow }) {
  return (
    <header className={`topbar ${narrow ? "topbar--narrow" : ""}`}>
      <div className="topbar__inner">
        <button className="topbar__back" onClick={onBack} aria-label={backLabel}>
          <IcoAtras />
        </button>
        <div className="topbar__titles">
          <span className="topbar__eyebrow">{eyebrow}</span>
          <span className="topbar__title">{title}</span>
        </div>
        <span className="topbar__spacer" aria-hidden="true" />
      </div>
    </header>
  );
}
