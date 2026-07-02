import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase.js";
import { parseCsv, toCsv, downloadText } from "../lib/csv.js";
import "./Admin.css";

const CARTA_VACIA = { id: null, color: "roja", tipo: "", texto: "", flavor: "", activa: true };
const REDIRECT = () => `${window.location.origin}/?admin`;

// ¿Es una sesión real (no anónima)?
const esReal = (session) => !!session && session.user && !session.user.is_anonymous;

export default function Admin({ onBack }) {
  const [session, setSession] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  // Login
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMsg, setAuthMsg] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  // Cartas
  const [cartas, setCartas] = useState([]);
  const [cargandoCartas, setCargandoCartas] = useState(false);
  const [color, setColor] = useState("todas");
  const [tipoFiltro, setTipoFiltro] = useState("todas");
  const [q, setQ] = useState("");
  const [soloActivas, setSoloActivas] = useState(false);
  const [editando, setEditando] = useState(null); // objeto carta o null
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  // --- Sesión + rol ---
  const revisarRol = useCallback(async (s) => {
    if (!esReal(s)) {
      setIsAdmin(false);
      return;
    }
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", s.user.id)
      .eq("role", "admin")
      .maybeSingle();
    setIsAdmin(!!data);
  }, []);

  useEffect(() => {
    let activo = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!activo) return;
      setSession(data.session);
      await revisarRol(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, s) => {
      setSession(s);
      await revisarRol(s);
    });
    return () => {
      activo = false;
      sub.subscription.unsubscribe();
    };
  }, [revisarRol]);

  // --- Cargar cartas cuando somos admin ---
  const cargarCartas = useCallback(async () => {
    setCargandoCartas(true);
    const { data, error } = await supabase
      .from("cartas")
      .select("*")
      .order("color")
      .order("tipo", { nullsFirst: true })
      .order("texto");
    if (error) setMsg("Error cargando cartas: " + error.message);
    else setCartas(data || []);
    setCargandoCartas(false);
  }, []);

  useEffect(() => {
    if (isAdmin) cargarCartas();
  }, [isAdmin, cargarCartas]);

  // --- Auth handlers ---
  const loginEmail = async (e) => {
    e.preventDefault();
    setAuthMsg("");
    setAuthBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setAuthBusy(false);
    if (error) setAuthMsg(error.message);
  };
  const registrarEmail = async () => {
    setAuthMsg("");
    if (!email.trim() || !password) return setAuthMsg("Escribe correo y contraseña.");
    setAuthBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: REDIRECT() },
    });
    setAuthBusy(false);
    if (error) return setAuthMsg(error.message);
    if (!data.session) setAuthMsg("Cuenta creada. Revisa tu correo para confirmarla y luego inicia sesión.");
  };
  const loginGoogle = async () => {
    setAuthMsg("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: REDIRECT() },
    });
    if (error) setAuthMsg(error.message);
  };
  const logout = async () => {
    await supabase.auth.signOut();
    setIsAdmin(false);
  };

  // --- CRUD ---
  const guardar = async () => {
    const c = editando;
    if (!c.texto.trim()) return setMsg("El texto es obligatorio.");
    if (!["verde", "roja"].includes(c.color)) return setMsg("Color inválido.");
    setBusy(true);
    setMsg("");
    const payload = {
      color: c.color,
      tipo: c.tipo?.trim() || null,
      texto: c.texto.trim(),
      flavor: c.flavor?.trim() || null,
      activa: !!c.activa,
    };
    let error;
    if (c.id) ({ error } = await supabase.from("cartas").update(payload).eq("id", c.id));
    else ({ error } = await supabase.from("cartas").insert(payload));
    setBusy(false);
    if (error) {
      setMsg(error.code === "23505" ? `Ya existe una carta ${c.color} con ese texto.` : error.message);
      return;
    }
    setEditando(null);
    setMsg(c.id ? "Carta actualizada." : "Carta creada.");
    cargarCartas();
  };

  const borrar = async (carta) => {
    if (!confirm(`¿Borrar la carta "${carta.texto}"? Esto no se puede deshacer.`)) return;
    setBusy(true);
    const { error } = await supabase.from("cartas").delete().eq("id", carta.id);
    setBusy(false);
    if (error) return setMsg(error.message);
    setMsg("Carta borrada.");
    cargarCartas();
  };

  const toggleActiva = async (carta) => {
    const { error } = await supabase.from("cartas").update({ activa: !carta.activa }).eq("id", carta.id);
    if (error) return setMsg(error.message);
    setCartas((cs) => cs.map((x) => (x.id === carta.id ? { ...x, activa: !x.activa } : x)));
  };

  // --- CSV ---
  const exportarCsv = () => {
    const filas = [["color", "tipo", "texto", "flavor", "activa"]];
    cartas.forEach((c) => filas.push([c.color, c.tipo || "", c.texto, c.flavor || "", c.activa ? "true" : "false"]));
    downloadText(`cartas-${cartas.length}.csv`, toCsv(filas));
  };

  const importarCsv = async (file) => {
    setMsg("");
    setBusy(true);
    try {
      const filas = parseCsv(await file.text()).filter((f) => f.some((v) => v.trim() !== ""));
      if (filas.length < 2) throw new Error("El CSV está vacío o solo tiene la cabecera.");
      const head = filas[0].map((h) => h.trim().toLowerCase());
      const idx = (name) => head.indexOf(name);
      const iColor = idx("color"), iTipo = idx("tipo"), iTexto = idx("texto"),
        iFlavor = idx("flavor"), iActiva = idx("activa");
      if (iColor < 0 || iTexto < 0) throw new Error("Faltan columnas obligatorias: color y texto.");

      const registros = [];
      const errores = [];
      for (let r = 1; r < filas.length; r++) {
        const f = filas[r];
        const col = (f[iColor] || "").trim().toLowerCase();
        const texto = (f[iTexto] || "").trim();
        if (!["verde", "roja"].includes(col) || !texto) {
          errores.push(`Fila ${r + 1}: color o texto inválido.`);
          continue;
        }
        const activaRaw = iActiva >= 0 ? (f[iActiva] || "").trim().toLowerCase() : "";
        registros.push({
          color: col,
          tipo: iTipo >= 0 ? (f[iTipo] || "").trim() || null : null,
          texto,
          flavor: iFlavor >= 0 ? (f[iFlavor] || "").trim() || null : null,
          activa: !["false", "0", "no"].includes(activaRaw),
        });
      }
      if (registros.length === 0) throw new Error("Ninguna fila válida.");
      const { error } = await supabase.from("cartas").upsert(registros, { onConflict: "color,texto" });
      if (error) throw error;
      setMsg(`Importadas/actualizadas ${registros.length} cartas.${errores.length ? ` ${errores.length} filas ignoradas.` : ""}`);
      cargarCartas();
    } catch (err) {
      setMsg("Error importando: " + err.message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  // --- Derivados ---
  const tipos = useMemo(
    () => [...new Set(cartas.map((c) => c.tipo).filter(Boolean))].sort(),
    [cartas]
  );
  const filtradas = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return cartas.filter((c) => {
      if (color !== "todas" && c.color !== color) return false;
      if (tipoFiltro !== "todas" && (c.tipo || "") !== tipoFiltro) return false;
      if (soloActivas && !c.activa) return false;
      if (needle) {
        const hay = `${c.texto} ${c.flavor || ""} ${c.tipo || ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [cartas, color, tipoFiltro, q, soloActivas]);

  // --- Render: cargando ---
  if (loading) {
    return (
      <div className="admin admin--center">
        <p>Cargando…</p>
      </div>
    );
  }

  // --- Render: login ---
  if (!esReal(session)) {
    return (
      <div className="admin admin--center">
        <div className="admin__login">
          <h1 className="admin__title">Panel de administración</h1>
          <p className="admin__sub">Acceso solo para el equipo. Inicia sesión.</p>
          <form onSubmit={loginEmail} className="admin__form">
            <input
              className="admin__input"
              type="email"
              placeholder="Correo"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
            <input
              className="admin__input"
              type="password"
              placeholder="Contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            <button className="admin__btn admin__btn--primary" disabled={authBusy} type="submit">
              Iniciar sesión
            </button>
          </form>
          <button className="admin__btn" disabled={authBusy} onClick={registrarEmail}>
            Crear cuenta
          </button>
          <div className="admin__divider"><span>o</span></div>
          <button className="admin__btn admin__btn--google" disabled={authBusy} onClick={loginGoogle}>
            Continuar con Google
          </button>
          {authMsg && <p className="admin__msg">{authMsg}</p>}
          <button className="admin__link" onClick={onBack}>← Volver al juego</button>
        </div>
      </div>
    );
  }

  // --- Render: sesión sin rol admin ---
  if (!isAdmin) {
    return (
      <div className="admin admin--center">
        <div className="admin__login">
          <h1 className="admin__title">Sin permiso</h1>
          <p className="admin__sub">
            La cuenta <b>{session.user.email}</b> no tiene rol de administrador.
          </p>
          <button className="admin__btn" onClick={logout}>Cerrar sesión</button>
          <button className="admin__link" onClick={onBack}>← Volver al juego</button>
        </div>
      </div>
    );
  }

  // --- Render: panel admin ---
  return (
    <div className="admin">
      <header className="admin__top">
        <h1 className="admin__title">Cartas</h1>
        <span className="admin__who">
          {session.user.email}
          <button className="admin__link" onClick={logout}>salir</button>
          <button className="admin__link" onClick={onBack}>← juego</button>
        </span>
      </header>

      <div className="admin__bar">
        <select value={color} onChange={(e) => setColor(e.target.value)} className="admin__sel">
          <option value="todas">Todos los colores</option>
          <option value="roja">🔴 Rojas</option>
          <option value="verde">🟢 Verdes</option>
        </select>
        <select value={tipoFiltro} onChange={(e) => setTipoFiltro(e.target.value)} className="admin__sel">
          <option value="todas">Todas las categorías</option>
          {tipos.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <input
          className="admin__search"
          placeholder="Buscar…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="admin__check">
          <input type="checkbox" checked={soloActivas} onChange={(e) => setSoloActivas(e.target.checked)} />
          Solo activas
        </label>
        <span className="admin__count">{filtradas.length} / {cartas.length}</span>
        <div className="admin__actions">
          <button className="admin__btn admin__btn--primary" onClick={() => setEditando({ ...CARTA_VACIA })}>
            + Nueva
          </button>
          <button className="admin__btn" onClick={exportarCsv}>Exportar CSV</button>
          <button className="admin__btn" onClick={() => fileRef.current?.click()}>Importar CSV</button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => e.target.files[0] && importarCsv(e.target.files[0])}
          />
        </div>
      </div>

      {msg && <p className="admin__msg">{msg}</p>}

      <div className="admin__list">
        {cargandoCartas && <p className="admin__empty">Cargando cartas…</p>}
        {!cargandoCartas && filtradas.length === 0 && <p className="admin__empty">Sin resultados.</p>}
        {filtradas.map((c) => (
          <div key={c.id} className={`admin__row ${c.activa ? "" : "admin__row--off"}`}>
            <span className={`admin__dot admin__dot--${c.color}`} />
            <div className="admin__cardtext">
              <span className="admin__cardtitle">{c.texto}</span>
              {c.flavor && <span className="admin__cardflavor">{c.flavor}</span>}
            </div>
            <span className="admin__tag">{c.tipo || "—"}</span>
            <button
              className={`admin__pill ${c.activa ? "admin__pill--on" : ""}`}
              onClick={() => toggleActiva(c)}
              title="Activa en el mazo"
            >
              {c.activa ? "activa" : "inactiva"}
            </button>
            <button className="admin__mini" onClick={() => setEditando({ ...c })}>Editar</button>
            <button className="admin__mini admin__mini--danger" onClick={() => borrar(c)}>Borrar</button>
          </div>
        ))}
      </div>

      {/* Modal crear/editar */}
      {editando && (
        <div className="admin__modal" onClick={() => setEditando(null)}>
          <div className="admin__dialog" onClick={(e) => e.stopPropagation()}>
            <h2 className="admin__dtitle">{editando.id ? "Editar carta" : "Nueva carta"}</h2>
            <label className="admin__field">
              <span>Color</span>
              <select
                value={editando.color}
                onChange={(e) => setEditando({ ...editando, color: e.target.value })}
              >
                <option value="roja">🔴 Roja (sustantivo)</option>
                <option value="verde">🟢 Verde (adjetivo)</option>
              </select>
            </label>
            <label className="admin__field">
              <span>Categoría (tipo)</span>
              <input
                value={editando.tipo || ""}
                onChange={(e) => setEditando({ ...editando, tipo: e.target.value })}
                placeholder="Ej: Personajes (opcional)"
              />
            </label>
            <label className="admin__field">
              <span>Texto *</span>
              <textarea
                value={editando.texto}
                onChange={(e) => setEditando({ ...editando, texto: e.target.value })}
                rows={2}
              />
            </label>
            <label className="admin__field">
              <span>Flavor</span>
              <textarea
                value={editando.flavor || ""}
                onChange={(e) => setEditando({ ...editando, flavor: e.target.value })}
                rows={2}
                placeholder="Frase/chiste al pie (opcional)"
              />
            </label>
            <label className="admin__check admin__check--field">
              <input
                type="checkbox"
                checked={!!editando.activa}
                onChange={(e) => setEditando({ ...editando, activa: e.target.checked })}
              />
              Activa (entra al mazo)
            </label>
            <div className="admin__dbtns">
              <button className="admin__btn admin__btn--primary" disabled={busy} onClick={guardar}>
                {busy ? "Guardando…" : "Guardar"}
              </button>
              <button className="admin__btn" onClick={() => setEditando(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
