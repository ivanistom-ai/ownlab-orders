import { useState, useEffect, useRef, useCallback } from "react";

// ─── ДИЗАЙН-ТОКЕНЫ OWNLAB ─────────────────────────────────────────────────────
const T = {
  org: "#E8651A", orgD: "rgba(232,101,26,0.10)", orgG: "rgba(232,101,26,0.25)",
  // Светлая шкала: g900 = фон страницы, g800 = карточки/панели, вниз = темнее
  g950:"#EDEDED", g900:"#F4F4F4", g800:"#FFFFFF", g750:"#FAFAFA",
  g700:"#F0F0F0", g650:"#EBEBEB", g600:"#E2E2E2", g550:"#D4D4D4",
  g500:"#C0C0C0", g400:"#999999", g300:"#777777", g200:"#555555", g100:"#3A3A3A", white:"#1E1E1E",
  green:"#16A34A", yellow:"#CA8A04", blue:"#2563EB", purple:"#7C3AED",
  red:"#DC2626", teal:"#059669",
  fontMain:"'Montserrat', sans-serif", fontMono:"'JetBrains Mono', monospace",
};

// ─── ЭТАПЫ (14 шт) ────────────────────────────────────────────────────────────
const STAGES = [
  { emoji:"🟢", name:"Заказ создан",             color:"green",    approval:false, warning:false, tracking:false,
    desc:"Врач оформил заявку онлайн через портал лаборатории.",
    subs:["Загружены фото и сканы","Указан оттенок (Vita/BL)","Заполнено техническое задание","Прикреплены комментарии врача"] },
  { emoji:"🟢", name:"Заказ принят лабораторией",color:"green",
    desc:"Менеджер проверил заявку, подтвердил сроки, назначил техника.",
    subs:["Заявка проверена менеджером","Сроки выполнения подтверждены","Назначен ответственный техник"] },
  { emoji:"🟡", name:"Техническая проверка / анализ кейса", color:"yellow", warning:true,
    desc:"Технический анализ входных данных перед запуском в производство.",
    subs:["Проверка качества и полноты сканов","Анализ окклюзии и прикуса","Проверка ТЗ и пожеланий","Если данных не хватает → кнопка «Требуются данные»"] },
  { emoji:"🟡", name:"Планирование работы",      color:"yellow",
    desc:"Выбор протокола изготовления и распределение по специалистам.",
    subs:["Определён протокол изготовления","Работа распределена по специалистам","Внутренние сроки согласованы"] },
  { emoji:"🔵", name:"Цифровое моделирование (CAD)", color:"blue",
    desc:"Создание 3D-дизайна реставрации в программе CAD.",
    subs:["Импорт STL-сканов","Создание цифрового дизайна","Моделировка виниров / коронок","Проверка пропорций, контактов и окклюзии"] },
  { emoji:"🔵", name:"Согласование дизайна",     color:"blue", approval:true,
    desc:"Врач получает 3D-визуализацию для согласования до производства.",
    subs:[] },
  { emoji:"🔵", name:"Производство / изготовление", color:"blue",
    desc:"Изготовление реставрации по утверждённому цифровому дизайну.",
    subs:["Печать (3D-принтер)","Фрезеровка (CAM / 5-осевой фрезер)","Прессование (е.мах)","Нанесение керамических масс","Обжиг в печи"] },
  { emoji:"🟠", name:"Индивидуальная работа техника", color:"orange",
    desc:"Финишная ручная персонализация изделия старшим техником.",
    subs:["Окрашивание (эффекты, характеристики)","Текстурирование поверхности","Персонализация под пациента","Финальный обжиг / полировка"] },
  { emoji:"🟠", name:"Контроль качества OWNLAB", color:"orange",
    desc:"Финальная проверка по стандартам качества OWN Digital Laboratory.",
    subs:["Проверка посадки на модели","Проверка апроксимальных контактов","Контроль окклюзионных контактов","Эстетический контроль (цвет, текстура)","Соответствие ТЗ"] },
  { emoji:"🟠", name:"Работа готова",             color:"orange",
    desc:"Реставрация прошла все проверки, готова к отправке.",
    subs:["Фотофиксация готовой работы","Упаковка в боксы с маркировкой"] },
  { emoji:"🚚", name:"Передана в доставку",       color:"delivery",
    desc:"Изделие упаковано и передано в курьерскую службу.",
    subs:["Профессиональная упаковка с защитой","Оформлены сопроводительные документы","Передано в СДЭК / курьеру"] },
  { emoji:"🚚", name:"В пути",                    color:"delivery", tracking:true,
    desc:"Курьер доставляет работу в клинику. Трек-номер отправлен врачу.",
    subs:[] },
  { emoji:"✅", name:"Получена клиникой",          color:"done",
    desc:"Врач подтвердил получение. Проверена целостность упаковки.",
    subs:["Врач подтвердил получение","Целостность упаковки проверена"] },
  { emoji:"⭐", name:"Заказ завершён",             color:"done",
    desc:"Работа принята, пациент доволен. Получен отзыв о сотрудничестве.",
    subs:["Отзыв врача получен","Архив заказа сформирован"] },
];

// ─── ТЕСТОВЫЕ ЗАКАЗЫ ─────────────────────────────────────────────────────────
const INITIAL_ORDERS = [
  { id:"o1", orderNum:"#OWN-0051", patient:"Сергеев А.В.", clinic:"Клиника Иванова И.И.", doctor:"Иванов И.И.",
    workType:"10 виниров / е.мах", units:10, shade:"BL1", material:"IPS e.max",
    teeth:"13,12,11,21,22,23,33,32,31,41", deadline:"24.05.2025",
    tech:"Артём К.", techKey:"Артём", color:"blue", activeStage:5, progress:43, urgent:true,
    needsData:false, approvalStatus:"waiting",
    files:[{n:"scan_upper.stl",i:"🦷"},{n:"scan_lower.stl",i:"🦷"},{n:"photo_pre.jpg",i:"📸"},{n:"tz_client.pdf",i:"📄"}],
    comments:[
      {author:"Иван Ж.",role:"admin",av:"ИЖ",text:"Очень важный пациент. Максимум внимания к эстетике. Ориентир BL1, без синевы.",time:"09:14"},
      {author:"Артём К.",role:"tech",av:"АК",text:"Принял в работу, сканы хорошие. Приступаю к CAD-моделированию.",time:"10:32"},
      {author:"Иван Ж.",role:"admin",av:"ИЖ",text:"Отлично. После CAD — обязательно согласование с врачом.",time:"10:45"},
    ]},
  { id:"o2", orderNum:"#OWN-0052", patient:"Ким Н.В.", clinic:"Дент Плюс", doctor:"Петренко А.А.",
    workType:"4 коронки / цирконий", units:4, shade:"A2", material:"Цирконий Ultra HT",
    teeth:"15,14,24,25", deadline:"29.05.2025",
    tech:"Мария В.", techKey:"Мария", color:"green", activeStage:2, progress:14, urgent:false,
    files:[{n:"scans.stl",i:"🦷"},{n:"foto_before.jpg",i:"📸"}],
    comments:[{author:"Мария В.",role:"tech",av:"МВ",text:"Заказ принят. Сканы отличного качества. Приступаю к анализу кейса.",time:"11:00"}]},
  { id:"o3", orderNum:"#OWN-0053", patient:"Орлова М.С.", clinic:"Стомасервис", doctor:"Захаров П.В.",
    workType:"Мостовидный протез", units:3, shade:"A3", material:"е.мах (IPS e.max)",
    teeth:"45,46,47", deadline:"31.05.2025",
    tech:"Дмитрий Н.", techKey:"Дмитрий", color:"yellow", activeStage:3, progress:21, urgent:false,
    needsData:true,
    files:[{n:"scan_jaw.stl",i:"🦷"}],
    comments:[{author:"Дмитрий Н.",role:"tech",av:"ДН",text:"⚠️ Скан нижней челюсти неполный — нет 47 зуба. Прошу прислать повторный скан.",time:"13:20"}]},
  { id:"o4", orderNum:"#OWN-0049", patient:"Волков Д.А.", clinic:"Клиника Иванова И.И.", doctor:"Иванов И.И.",
    workType:"6 виниров / е.мах", units:6, shade:"BL2", material:"IPS e.max",
    teeth:"13,12,11,21,22,23", deadline:"22.05.2025",
    tech:"Артём К.", techKey:"Артём", color:"orange", activeStage:9, progress:86, urgent:true,
    files:[{n:"scan.stl",i:"🦷"},{n:"cad_design.3dm",i:"💻"},{n:"photo_cad.jpg",i:"📸"},{n:"photo_ready.jpg",i:"📸"}],
    comments:[
      {author:"Артём К.",role:"tech",av:"АК",text:"Виниры готовы. Цвет — точно в BL2. Сейчас финальная проверка QC.",time:"08:10"},
      {author:"Иван Ж.",role:"admin",av:"ИЖ",text:"Проверил — отлично! Срочно в доставку после QC.",time:"09:30"},
    ]},
  { id:"o5", orderNum:"#OWN-0048", patient:"Петрова Е.И.", clinic:"Дент Плюс", doctor:"Петренко А.А.",
    workType:"Полная реставрация / 12 ед.", units:12, shade:"A1", material:"Цирконий + е.мах",
    teeth:"17–27 (верхняя)", deadline:"21.05.2025",
    tech:"Мария В.", techKey:"Мария", color:"delivery", activeStage:12, progress:92, urgent:false,
    trackingNum:"СДЭК-847362819", trackingStatus:"В пути · прибытие сегодня до 18:00",
    files:[{n:"scan_full.stl",i:"🦷"},{n:"cad.3dm",i:"💻"},{n:"design_ok.jpg",i:"📸"},{n:"final_1.jpg",i:"📸"},{n:"final_2.jpg",i:"📸"},{n:"invoice.pdf",i:"📄"}],
    comments:[
      {author:"Мария В.",role:"tech",av:"МВ",text:"Передала в СДЭК. Трек: СДЭК-847362819. Доставка сегодня.",time:"07:45"},
      {author:"Иван Ж.",role:"admin",av:"ИЖ",text:"Уведомление врачу отправлено. После получения — попросить отзыв.",time:"08:00"},
    ]},
  { id:"o6", orderNum:"#OWN-0054", patient:"Беляев К.О.", clinic:"Смайл Клиник", doctor:"Горина С.В.",
    workType:"Имплант-корона / цирконий", units:1, shade:"A3.5", material:"Katana UTML",
    teeth:"36", deadline:"05.06.2025",
    tech:"Дмитрий Н.", techKey:"Дмитрий", color:"green", activeStage:1, progress:7, urgent:false,
    files:[{n:"scan_36.stl",i:"🦷"},{n:"xray.jpg",i:"📸"}],
    comments:[]},
];

// ─── ЦВЕТА СТАТУСОВ ───────────────────────────────────────────────────────────
const STATUS_COLORS = {
  green:    { bg:"rgba(34,197,94,0.12)",  text:T.green  },
  yellow:   { bg:"rgba(234,179,8,0.12)",  text:T.yellow },
  blue:     { bg:"rgba(59,130,246,0.12)", text:T.blue   },
  orange:   { bg:T.orgD,                  text:T.org    },
  delivery: { bg:"rgba(168,85,247,0.12)", text:T.purple },
  done:     { bg:"rgba(16,185,129,0.12)", text:T.teal   },
};
const STAGE_COLOR_MAP = {
  green: T.green, yellow: T.yellow, blue: T.blue,
  orange: T.org, delivery: T.purple, done: T.teal,
};

// ─── УТИЛИТЫ ─────────────────────────────────────────────────────────────────
const daysAgo = (n) => {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toLocaleDateString("ru-RU",{day:"2-digit",month:"2-digit"});
};
const nowTime = () => new Date().toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"});

// ─── GLOBAL FONT INJECT ───────────────────────────────────────────────────────
const injectFonts = () => {
  if (!document.getElementById("ownlab-fonts")) {
    const l = document.createElement("link");
    l.id = "ownlab-fonts"; l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap";
    document.head.appendChild(l);
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN APP
// ═══════════════════════════════════════════════════════════════════════════════
export default function OwnLabOrders() {
  injectFonts();

  const [orders, setOrders]           = useState(INITIAL_ORDERS);
  const [selectedId, setSelectedId]   = useState("o1");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterTech, setFilterTech]   = useState("all");
  const [searchQ, setSearchQ]         = useState("");
  const [activeTab, setActiveTab]     = useState("timeline");
  const [showModal, setShowModal]     = useState(false);
  const [toast, setToast]             = useState(null);
  const toastRef = useRef(null);

  // Форма нового заказа
  const [form, setForm] = useState({
    patient:"",clinic:"",doctor:"",type:"",units:"",shade:"",teeth:"",
    material:"",deadline:"",tech:"",priority:"normal",approval:"yes",notes:""
  });
  const [commentText, setCommentText] = useState("");

  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") { setSelectedId(null); setShowModal(false); }};
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // ── Toast ────────────────────────────────────────────────────────────────────
  const showToast = useCallback((title, sub="", type="success") => {
    setToast({ title, sub, type });
    clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(null), 3400);
  }, []);

  // ── Заказы ───────────────────────────────────────────────────────────────────
  const selectedOrder = orders.find(o => o.id === selectedId);

  const filteredOrders = orders.filter(o => {
    const ms = filterStatus === "all" || o.color === filterStatus;
    const mt = filterTech === "all" || o.techKey === filterTech;
    const q = searchQ.toLowerCase();
    const mq = !q || [o.patient,o.clinic,o.orderNum,o.workType].some(v=>v.toLowerCase().includes(q));
    return ms && mt && mq;
  });

  const updateOrder = (id, patch) =>
    setOrders(prev => prev.map(o => o.id === id ? { ...o, ...patch } : o));

  const handleAction = (action, orderId) => {
    const o = orders.find(x => x.id === orderId);
    if (!o) return;
    if (action === "next" && o.activeStage < 14) {
      const ns = o.activeStage + 1;
      const stage = STAGES[ns - 1];
      updateOrder(orderId, {
        activeStage: ns,
        progress: Math.min(100, Math.round((ns / 14) * 100)),
        color: stage.color,
      });
      showToast("Этап обновлён", `Этап ${ns}: ${stage.name}`);
    } else if (action === "needsData") {
      showToast("Запрос данных отправлен","Уведомление врачу "+o.doctor,"warning");
    } else if (action === "approved") {
      showToast("Дизайн согласован ✅","Запускаем производство");
      setTimeout(() => handleAction("next", orderId), 400);
    } else if (action === "revision") {
      showToast("Отправлено на доработку 🔄","Техник уведомлён","warning");
    } else if (action === "resend") {
      showToast("Визуализация отправлена 📩","На email врача: "+o.doctor);
    } else if (action === "received") {
      showToast("Клиника получила ✅","Завершаем заказ");
      setTimeout(() => handleAction("next", orderId), 400);
    } else if (action === "photo") {
      showToast("Загрузка фото","Функция доступна в полной версии");
    } else if (action === "track") {
      showToast("Трекинг","СДЭК: "+(o.trackingNum||"—"));
    }
  };

  const sendComment = () => {
    if (!commentText.trim() || !selectedId) return;
    updateOrder(selectedId, {
      comments: [...(selectedOrder?.comments||[]), {
        author:"Иван Ж.", role:"admin", av:"ИЖ",
        text: commentText.trim(), time: nowTime()
      }]
    });
    setCommentText("");
    showToast("Сообщение отправлено","Техник уведомлён");
  };

  const submitOrder = () => {
    const req = [{id:"patient",l:"Пациент"},{id:"clinic",l:"Клиника"},{id:"type",l:"Тип работы"},{id:"units",l:"Количество"},{id:"deadline",l:"Срок"}];
    for (const f of req) {
      if (!form[f.id]) { showToast("Заполните поле", f.l+" — обязательное поле","error"); return; }
    }
    const types = {veneers_emax:"Виниры (е.мах)",crown_zirconia:"Коронки (цирконий)",crown_emax:"Коронки (е.мах)",bridge:"Мостовидный протез",implant_crown:"Имплант-корона",full_mouth:"Полная реставрация",temp:"Временные (ПММА)"};
    const techs = {artem:"Артём К.",maria:"Мария В.",dmitry:"Дмитрий Н."};
    const num = "#OWN-0"+(55+orders.length);
    const dl = form.deadline ? new Date(form.deadline).toLocaleDateString("ru-RU",{day:"2-digit",month:"2-digit",year:"numeric"}) : "—";
    const newO = {
      id:"o"+Date.now(), orderNum:num, patient:form.patient, clinic:form.clinic,
      doctor:form.doctor||"—", workType:types[form.type]||form.type,
      units:parseInt(form.units)||1, shade:form.shade||"—", material:form.material||"—",
      teeth:form.teeth||"—", deadline:dl, tech:techs[form.tech]||"—",
      techKey:(techs[form.tech]||"").split(" ")[0],
      color:"green", activeStage:1, progress:4, urgent:form.priority==="urgent",
      files:[], comments:[]
    };
    setOrders(prev=>[newO,...prev]);
    setShowModal(false);
    setForm({patient:"",clinic:"",doctor:"",type:"",units:"",shade:"",teeth:"",material:"",deadline:"",tech:"",priority:"normal",approval:"yes",notes:""});
    setSelectedId(newO.id);
    showToast("✅ Заказ создан · "+num,"Уведомление отправлено технику и врачу");
  };

  // ── Счётчики для сайдбара ─────────────────────────────────────────────────
  const counts = orders.reduce((acc,o)=>{ acc[o.color]=(acc[o.color]||0)+1; return acc; },{});

  // ═══════════════════════════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div style={{ fontFamily:T.fontMain, background:T.g900, color:T.white, height:"100vh", display:"flex", flexDirection:"column", overflow:"hidden" }}>

      {/* ── HEADER ── */}
      <header style={{ background:T.g800, borderBottom:`1px solid ${T.g600}`, height:56, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 24px", flexShrink:0, zIndex:100 }}>
        <div style={{ display:"flex", alignItems:"baseline", gap:2 }}>
          <span style={{ fontSize:20, fontWeight:800, color:T.org, letterSpacing:3 }}>OWN</span>
          <span style={{ fontSize:9, fontWeight:500, color:T.g300, letterSpacing:"2.5px", marginLeft:8, textTransform:"uppercase" }}>Digital Laboratory</span>
        </div>
        <div style={{ background:T.orgD, border:`1px solid ${T.orgG}`, color:T.org, fontSize:9, fontWeight:700, padding:"3px 10px", borderRadius:4, letterSpacing:"1.5px", textTransform:"uppercase" }}>
          Система заказов v1.0
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:16 }}>
          <span style={{ position:"relative", cursor:"pointer", fontSize:17, color:T.g300 }} onClick={()=>showToast("3 новых события","Требует вашего внимания","warning")}>
            🔔
            <span style={{ position:"absolute", top:0, right:0, width:7, height:7, background:T.org, borderRadius:"50%", border:`1.5px solid ${T.g800}` }}/>
          </span>
          <div style={{ width:30, height:30, background:T.g600, border:`1.5px solid ${T.g500}`, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, color:T.org, cursor:"pointer" }}>ИЖ</div>
        </div>
      </header>

      {/* ── BODY ── */}
      <div style={{ display:"grid", gridTemplateColumns:"240px 1fr", flex:1, overflow:"hidden" }}>

        {/* ── SIDEBAR ── */}
        <aside style={{ background:T.g800, borderRight:`1px solid ${T.g600}`, overflowY:"auto", display:"flex", flexDirection:"column", padding:"14px 0 24px" }}>
          <div style={{ padding:"0 8px" }}>
            <button onClick={()=>setShowModal(true)} style={{
              width:"100%", padding:"11px 14px", background:T.org, color:"#fff", border:"none",
              borderRadius:8, fontFamily:T.fontMain, fontSize:12, fontWeight:700, letterSpacing:.5,
              display:"flex", alignItems:"center", justifyContent:"center", gap:7, marginBottom:14,
              cursor:"pointer", transition:"all .2s"
            }} onMouseOver={e=>e.currentTarget.style.background="#D45A10"} onMouseOut={e=>e.currentTarget.style.background=T.org}>
              <span style={{ fontSize:16 }}>＋</span> Новый заказ
            </button>

            <NavSection label="По статусу">
              {[
                {k:"all",    icon:"📋", label:"Все заказы",      cnt:orders.length},
                {k:"green",  icon:"🟢", label:"Приём / проверка",cnt:counts.green||0},
                {k:"yellow", icon:"🟡", label:"Анализ / план",   cnt:counts.yellow||0},
                {k:"blue",   icon:"🔵", label:"Производство",    cnt:counts.blue||0},
                {k:"orange", icon:"🟠", label:"Финишинг / QC",   cnt:counts.orange||0},
                {k:"delivery",icon:"🚚",label:"Доставка",        cnt:counts.delivery||0},
                {k:"done",   icon:"✅", label:"Завершённые",     cnt:counts.done||0},
              ].map(f=>(
                <NavItem key={f.k} active={filterStatus===f.k} icon={f.icon} label={f.label} count={f.cnt}
                  onClick={()=>{ setFilterStatus(f.k); setSelectedId(null); }}/>
              ))}
            </NavSection>

            <Divider/>

            <NavSection label="По технику">
              {[
                {k:"all",     icon:"👥", label:"Все техники"},
                {k:"Артём",   icon:"🔷", label:"Артём К."},
                {k:"Мария",   icon:"🔶", label:"Мария В."},
                {k:"Дмитрий", icon:"🔹", label:"Дмитрий Н."},
              ].map(f=>(
                <NavItem key={f.k} active={filterTech===f.k} icon={f.icon} label={f.label}
                  onClick={()=>setFilterTech(f.k)}/>
              ))}
            </NavSection>

            <Divider/>

            <NavSection label="Разделы">
              {[{i:"📊",l:"Аналитика"},{i:"⏱",l:"Сроки"},{i:"💬",l:"Переписка"},{i:"⚙️",l:"Настройки"}].map(x=>(
                <NavItem key={x.l} icon={x.i} label={x.l} onClick={()=>showToast("Раздел «"+x.l+"»","Доступно в полной версии")}/>
              ))}
            </NavSection>
          </div>

          {/* Мини-статистика */}
          <div style={{ marginTop:"auto", padding:"12px 16px 0" }}>
            <Divider style={{ margin:"0 0 10px" }}/>
            <div style={{ fontSize:9, fontWeight:700, letterSpacing:2, color:T.g400, textTransform:"uppercase", marginBottom:8 }}>Сегодня</div>
            {[["Выполнено этапов",7,T.org],["Закрыто заказов",2,T.green],["Просрочено",0,T.red]].map(([k,v,c])=>(
              <div key={k} style={{ display:"flex", justifyContent:"space-between", padding:"3px 0", fontSize:11 }}>
                <span style={{ color:T.g400 }}>{k}</span>
                <span style={{ fontFamily:T.fontMono, fontWeight:600, color:c }}>{v}</span>
              </div>
            ))}
          </div>
        </aside>

        {/* ── MAIN + DETAIL WRAPPER ── */}
        <div style={{ display:"flex", overflow:"hidden", position:"relative" }}>

          {/* ── MAIN ── */}
          <main style={{ flex:1, overflowY:"auto", background:T.g900, minWidth:0 }}>

            {/* Топ-бар */}
            <div style={{ padding:"18px 24px 0", display:"flex", alignItems:"center", gap:14 }}>
              <div style={{ flex:1, maxWidth:400, position:"relative" }}>
                <span style={{ position:"absolute", left:12, top:"50%", transform:"translateY(-50%)", fontSize:14, color:T.g400, pointerEvents:"none" }}>🔍</span>
                <input value={searchQ} onChange={e=>setSearchQ(e.target.value)}
                  placeholder="Поиск по пациенту, клинике, ID..."
                  style={{ width:"100%", background:T.g800, border:`1px solid ${T.g600}`, borderRadius:7, padding:"10px 12px 10px 38px", color:T.white, fontFamily:T.fontMain, fontSize:12, outline:"none" }}
                  onFocus={e=>e.target.style.borderColor=T.org}
                  onBlur={e=>e.target.style.borderColor=T.g600}
                />
              </div>
              <div style={{ display:"flex", gap:10 }}>
                {[{n:filteredOrders.length,l:"Активных",c:T.org},{n:orders.filter(o=>o.urgent).length,l:"⚡ Срочных",c:T.red},{n:14,l:"Закрыто / мес",c:T.green}].map(s=>(
                  <div key={s.l} style={{ background:T.g800, border:`1px solid ${T.g600}`, borderRadius:7, padding:"7px 14px", display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ fontSize:17, fontWeight:700, fontFamily:T.fontMono, color:s.c, lineHeight:1 }}>{s.n}</span>
                    <span style={{ fontSize:10, color:T.g300 }}>{s.l}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Список заказов */}
            <div style={{ padding:"16px 24px 24px" }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:13 }}>
                <span style={{ fontSize:10, fontWeight:700, letterSpacing:2, textTransform:"uppercase", color:T.g300 }}>Активные заказы</span>
                <button style={{ background:T.g800, border:`1px solid ${T.g600}`, color:T.g300, fontSize:11, padding:"5px 10px", borderRadius:5, cursor:"pointer", fontFamily:T.fontMain }}>
                  По сроку ▾
                </button>
              </div>

              {filteredOrders.length === 0 ? (
                <div style={{ textAlign:"center", padding:"60px 0", color:T.g400 }}>
                  <div style={{ fontSize:36, marginBottom:12 }}>📭</div>
                  <div style={{ fontWeight:600, color:T.g300, marginBottom:4 }}>Заказы не найдены</div>
                  <div style={{ fontSize:11 }}>Измените фильтр или создайте новый заказ</div>
                </div>
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
                  {filteredOrders.map(o=>(
                    <OrderCard key={o.id} order={o} selected={o.id===selectedId}
                      onClick={()=>{ setSelectedId(o.id); setActiveTab("timeline"); }}/>
                  ))}
                </div>
              )}
            </div>
          </main>

          {/* ── DETAIL PANEL ── */}
          {selectedOrder && (
            <DetailPanel
              order={selectedOrder} activeTab={activeTab} setActiveTab={setActiveTab}
              commentText={commentText} setCommentText={setCommentText}
              onClose={()=>setSelectedId(null)}
              onAction={handleAction} onSendComment={sendComment}
            />
          )}
        </div>
      </div>

      {/* ── MODAL НОВЫЙ ЗАКАЗ ── */}
      {showModal && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", backdropFilter:"blur(4px)", zIndex:500, display:"flex", alignItems:"center", justifyContent:"center" }}
          onClick={()=>setShowModal(false)}>
          <div style={{ background:T.g800, border:`1px solid ${T.g600}`, borderRadius:12, padding:28, width:560, maxHeight:"92vh", overflowY:"auto", animation:"modalIn .2s" }}
            onClick={e=>e.stopPropagation()}>
            <div style={{ fontSize:18, fontWeight:700, marginBottom:4 }}>＋ Новый заказ-наряд</div>
            <div style={{ fontSize:11, color:T.g400, marginBottom:22, display:"flex", alignItems:"center", gap:6 }}>
              <span style={{ width:6, height:6, borderRadius:"50%", background:T.org, display:"inline-block" }}/>
              OWN Digital Laboratory — Создание заявки
            </div>

            <FormSection label="Пациент и клиника">
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <FInput label="Пациент *" placeholder="Фамилия И.О." value={form.patient} onChange={v=>setForm(f=>({...f,patient:v}))}/>
                <FInput label="Клиника *" placeholder="Название клиники" value={form.clinic} onChange={v=>setForm(f=>({...f,clinic:v}))}/>
              </div>
              <FInput label="Имя врача" placeholder="Фамилия И.О. врача" value={form.doctor} onChange={v=>setForm(f=>({...f,doctor:v}))}/>
            </FormSection>

            <FormDivider/>
            <FormSection label="Работа">
              <FSelect label="Тип работы *" value={form.type} onChange={v=>setForm(f=>({...f,type:v}))}
                options={[{v:"",l:"— Выберите тип —"},{v:"veneers_emax",l:"Виниры (е.мах / фельспат)"},{v:"veneers_pmma",l:"Виниры временные (ПММА)"},{v:"crown_zirconia",l:"Коронки (цирконий)"},{v:"crown_emax",l:"Коронки (е.мах)"},{v:"bridge",l:"Мостовидный протез"},{v:"implant_crown",l:"Имплант-корона"},{v:"full_mouth",l:"Полная реставрация"},{v:"temp",l:"Временные конструкции (ПММА)"}]}/>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <FInput label="Количество единиц *" placeholder="напр. 6" type="number" value={form.units} onChange={v=>setForm(f=>({...f,units:v}))}/>
                <FInput label="Оттенок (Vita/BL)" placeholder="напр. A2, BL1" value={form.shade} onChange={v=>setForm(f=>({...f,shade:v}))}/>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <FInput label="Зубы (номера)" placeholder="напр. 11,12,13,21,22,23" value={form.teeth} onChange={v=>setForm(f=>({...f,teeth:v}))}/>
                <FSelect label="Материал" value={form.material} onChange={v=>setForm(f=>({...f,material:v}))}
                  options={[{v:"",l:"— Материал —"},{v:"IPS e.max",l:"IPS e.max"},{v:"Цирконий Ultra HT",l:"Цирконий Ultra HT"},{v:"Katana UTML",l:"Katana UTML"},{v:"Фельспатовая керамика",l:"Фельспатовая керамика"},{v:"ПММА",l:"ПММА (временный)"},{v:"Металлокерамика",l:"Металлокерамика"}]}/>
              </div>
            </FormSection>

            <FormDivider/>
            <FormSection label="Сроки и ответственный">
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <FInput label="Срок выполнения *" type="date" value={form.deadline} onChange={v=>setForm(f=>({...f,deadline:v}))}/>
                <FSelect label="Техник" value={form.tech} onChange={v=>setForm(f=>({...f,tech:v}))}
                  options={[{v:"",l:"— Назначить техника —"},{v:"artem",l:"Артём К."},{v:"maria",l:"Мария В."},{v:"dmitry",l:"Дмитрий Н."}]}/>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <FSelect label="Приоритет" value={form.priority} onChange={v=>setForm(f=>({...f,priority:v}))}
                  options={[{v:"normal",l:"Стандартный"},{v:"urgent",l:"⚡ Срочный"},{v:"vip",l:"⭐ VIP"}]}/>
                <FSelect label="Согласование дизайна" value={form.approval} onChange={v=>setForm(f=>({...f,approval:v}))}
                  options={[{v:"yes",l:"Да — отправить врачу"},{v:"no",l:"Нет — пропустить этап 6"}]}/>
              </div>
            </FormSection>

            <FormDivider/>
            <FormSection label="Техническое задание">
              <div style={{ marginBottom:14 }}>
                <div style={{ fontSize:10, fontWeight:600, color:T.g300, letterSpacing:.5, marginBottom:6, textTransform:"uppercase" }}>Комментарии и ТЗ</div>
                <textarea value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))}
                  placeholder="Пожелания по форме, окклюзии, текстуре, особые требования..."
                  style={{ width:"100%", background:T.g700, border:`1px solid ${T.g600}`, borderRadius:5, padding:"9px 11px", color:T.white, fontFamily:T.fontMain, fontSize:12, resize:"vertical", minHeight:70, outline:"none" }}
                  onFocus={e=>e.target.style.borderColor=T.org} onBlur={e=>e.target.style.borderColor=T.g600}/>
              </div>
              <div style={{ border:`2px dashed ${T.g550}`, borderRadius:8, padding:18, textAlign:"center", cursor:"pointer", color:T.g400, fontSize:11 }}
                onClick={()=>showToast("Загрузка файлов","STL · DICOM · JPG · PDF до 500 МБ — в полной версии")}
                onMouseOver={e=>{e.currentTarget.style.borderColor=T.org;e.currentTarget.style.color=T.g200}}
                onMouseOut={e=>{e.currentTarget.style.borderColor=T.g550;e.currentTarget.style.color=T.g400}}>
                <div style={{ fontSize:26, marginBottom:6 }}>📁</div>
                <div style={{ marginBottom:3 }}>Перетащите файлы или <span style={{ color:T.org }}>выберите</span></div>
                <div style={{ fontSize:9, color:T.g500, letterSpacing:.5 }}>STL · DICOM · JPG · PNG · PDF · до 500 МБ</div>
              </div>
            </FormSection>

            <div style={{ display:"flex", gap:10, marginTop:22 }}>
              <button onClick={()=>setShowModal(false)} style={{ flex:1, padding:12, background:T.g700, color:T.g300, border:`1px solid ${T.g600}`, borderRadius:8, fontFamily:T.fontMain, fontSize:13, fontWeight:700, cursor:"pointer" }}>
                Отмена
              </button>
              <button onClick={submitOrder} style={{ flex:1, padding:12, background:T.org, color:"#fff", border:"none", borderRadius:8, fontFamily:T.fontMain, fontSize:13, fontWeight:700, cursor:"pointer" }}
                onMouseOver={e=>e.currentTarget.style.background="#D45A10"} onMouseOut={e=>e.currentTarget.style.background=T.org}>
                Создать заказ →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── TOAST ── */}
      {toast && (
        <div style={{
          position:"fixed", bottom:24, right:24, zIndex:999,
          background:T.g700, border:`1px solid ${T.g600}`,
          borderLeft:`3px solid ${toast.type==="error"?T.red:toast.type==="warning"?T.yellow:T.teal}`,
          borderRadius:8, padding:"14px 18px", display:"flex", alignItems:"center", gap:10,
          boxShadow:"0 8px 32px rgba(0,0,0,0.12)", minWidth:280,
          animation:"toastIn .3s cubic-bezier(.4,0,.2,1)"
        }}>
          <span style={{ fontSize:18 }}>{toast.type==="error"?"❌":toast.type==="warning"?"⚠️":"✅"}</span>
          <div>
            <div style={{ fontSize:12, fontWeight:700, color:T.white }}>{toast.title}</div>
            {toast.sub && <div style={{ fontSize:10, color:T.g300, marginTop:2 }}>{toast.sub}</div>}
          </div>
        </div>
      )}

      <style>{`
        @keyframes modalIn { from{transform:scale(.95) translateY(8px);opacity:0} to{transform:scale(1) translateY(0);opacity:1} }
        @keyframes toastIn  { from{transform:translateY(8px);opacity:0} to{transform:translateY(0);opacity:1} }
        @keyframes pulse    { 0%,100%{opacity:1} 50%{opacity:.2} }
        @keyframes slideIn  { from{transform:translateX(30px);opacity:0} to{transform:translateX(0);opacity:1} }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:#C0C0C0;border-radius:2px}
        ::-webkit-scrollbar-thumb:hover{background:#999}
        select option{background:#FFFFFF;color:#1E1E1E}
      `}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  КОМПОНЕНТЫ
// ═══════════════════════════════════════════════════════════════════════════════

function NavSection({ label, children }) {
  return (
    <div style={{ marginBottom:4 }}>
      <div style={{ fontSize:9, fontWeight:700, letterSpacing:2, color:T.g400, textTransform:"uppercase", padding:"0 8px", marginBottom:5 }}>{label}</div>
      {children}
    </div>
  );
}

function NavItem({ active, icon, label, count, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <div onClick={onClick}
      onMouseOver={()=>setHov(true)} onMouseOut={()=>setHov(false)}
      style={{
        display:"flex", alignItems:"center", gap:8, padding:"8px 10px",
        borderRadius:6, cursor:"pointer", fontSize:12, fontWeight:500,
        marginBottom:2, transition:"all .15s",
        borderLeft: active ? `2px solid ${T.org}` : "2px solid transparent",
        background: active ? T.orgD : hov ? T.g700 : "transparent",
        color: active ? T.org : hov ? T.white : T.g200,
      }}>
      <span>{icon}</span>
      <span style={{ flex:1 }}>{label}</span>
      {count !== undefined && <span style={{ fontFamily:T.fontMono, fontSize:10, color: active?T.org:T.g400 }}>{count}</span>}
    </div>
  );
}

function Divider({ style }) {
  return <div style={{ height:1, background:T.g600, margin:"10px 6px", ...style }}/>;
}

function OrderCard({ order: o, selected, onClick }) {
  const [hov, setHov] = useState(false);
  const sc = STATUS_COLORS[o.color] || STATUS_COLORS.green;
  const lc = STAGE_COLOR_MAP[o.color] || T.org;
  return (
    <div onClick={onClick} onMouseOver={()=>setHov(true)} onMouseOut={()=>setHov(false)}
      style={{
        background: selected ? "rgba(232,101,26,0.04)" : T.g800,
        border: `1px solid ${selected ? T.org : hov ? T.g500 : T.g600}`,
        borderLeft: `3px solid ${lc}`,
        borderRadius:8, padding:"13px 16px", cursor:"pointer",
        transform: hov ? "translateX(2px)" : "none",
        boxShadow: hov ? "0 4px 20px rgba(0,0,0,.3)" : "none",
        transition:"all .18s",
      }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:9, flexWrap:"nowrap" }}>
        <span style={{ fontFamily:T.fontMono, fontSize:11, fontWeight:500, color:T.org, background:T.orgD, padding:"2px 7px", borderRadius:4, whiteSpace:"nowrap", flexShrink:0 }}>{o.orderNum}</span>
        <span style={{ fontSize:13, fontWeight:600, flex:1, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{o.patient}</span>
        <span style={{ fontSize:10, color:T.g300, background:T.g700, padding:"2px 7px", borderRadius:4, whiteSpace:"nowrap", flexShrink:0 }}>{o.workType}</span>
        <span style={{ fontSize:10, fontFamily:T.fontMono, color: o.urgent ? T.red : T.g400, fontWeight: o.urgent ? 600 : 400, whiteSpace:"nowrap", flexShrink:0 }}>
          {o.urgent?"⚡ ":""}до {o.deadline}
        </span>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
        <span style={{ fontSize:11, color:T.g300, flex:1, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>🏥 {o.clinic} · {o.tech}</span>
        <span style={{ display:"flex", alignItems:"center", gap:5, fontSize:10, fontWeight:600, padding:"3px 9px", borderRadius:20, whiteSpace:"nowrap", background:sc.bg, color:sc.text }}>
          {STAGES[o.activeStage-1].emoji} {STAGES[o.activeStage-1].name}
        </span>
      </div>
      <div style={{ height:3, background:T.g600, borderRadius:2, marginTop:10, overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${o.progress}%`, background:`linear-gradient(90deg,${T.org},#FF9500)`, borderRadius:2, transition:"width .6s" }}/>
      </div>
    </div>
  );
}

// ── DETAIL PANEL ─────────────────────────────────────────────────────────────
function DetailPanel({ order: o, activeTab, setActiveTab, commentText, setCommentText, onClose, onAction, onSendComment }) {
  const commentsEndRef = useRef(null);
  useEffect(()=>{ commentsEndRef.current?.scrollIntoView({behavior:"smooth"}); },[o.comments?.length]);

  const TABS = [
    {k:"info",     l:"📋 Инфо"},
    {k:"timeline", l:"📍 Этапы"},
    {k:"files",    l:"📁 Файлы"},
    {k:"comments", l:"💬 Чат"},
  ];

  return (
    <div style={{ width:530, background:T.g800, borderLeft:`1px solid ${T.g600}`, display:"flex", flexDirection:"column", overflow:"hidden", flexShrink:0, animation:"slideIn .25s cubic-bezier(.4,0,.2,1)" }}>

      {/* Хедер */}
      <div style={{ padding:"18px 22px 14px", borderBottom:`1px solid ${T.g600}`, flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:10 }}>
          <div>
            <div style={{ fontSize:16, fontWeight:700 }}>{o.patient}</div>
            <div style={{ fontSize:11, color:T.g300, marginTop:2 }}>{o.orderNum} · {o.clinic}</div>
          </div>
          <button onClick={onClose} style={{ background:T.g700, border:`1px solid ${T.g600}`, color:T.g300, width:28, height:28, borderRadius:5, fontSize:14, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginLeft:10 }}
            onMouseOver={e=>{e.currentTarget.style.background=T.g600;e.currentTarget.style.color=T.white}}
            onMouseOut={e=>{e.currentTarget.style.background=T.g700;e.currentTarget.style.color=T.g300}}>✕</button>
        </div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          {[o.orderNum, `🦷 ${o.workType}`, `👤 ${o.tech}`, o.urgent?"⚡ Срочный":null].filter(Boolean).map(t=>(
            <span key={t} style={{ fontSize:10, color:T.g300, background:T.g700, border:`1px solid ${T.g600}`, padding:"3px 8px", borderRadius:4 }}>{t}</span>
          ))}
        </div>
      </div>

      {/* Табы */}
      <div style={{ display:"flex", borderBottom:`1px solid ${T.g600}`, flexShrink:0 }}>
        {TABS.map(tab=>(
          <button key={tab.k} onClick={()=>setActiveTab(tab.k)} style={{
            flex:1, padding:"10px 6px", fontSize:11, fontWeight:600,
            fontFamily:T.fontMain, background: activeTab===tab.k ? T.orgD : "none",
            color: activeTab===tab.k ? T.org : T.g300,
            border:"none", borderBottom: activeTab===tab.k ? `2px solid ${T.org}` : "2px solid transparent",
            cursor:"pointer", transition:"all .2s", letterSpacing:.3
          }}>
            {tab.l}
          </button>
        ))}
      </div>

      {/* Тело */}
      <div style={{ overflowY:"auto", flex:1 }}>

        {/* ── ТАБ ИНФО ── */}
        {activeTab==="info" && (
          <div style={{ padding:"14px 22px" }}>
            <InfoCard title="Детали заказа">
              {[
                ["Номер заказа",    o.orderNum,   "orange"],
                ["Пациент",        o.patient],
                ["Клиника",        o.clinic],
                ["Врач",           o.doctor||"—"],
                ["Тип работы",     o.workType],
                ["Единиц",         o.units+" ед."],
                ["Зубы",           o.teeth||"—"],
                ["Материал",       o.material||"—"],
                ["Оттенок",        o.shade||"—"],
                ["Срок",           "📅 "+o.deadline, o.urgent?"red":"orange"],
              ].map(([k,v,c])=>(
                <InfoRow key={k} label={k} value={v} color={c}/>
              ))}
            </InfoCard>
            <InfoCard title="Прогресс выполнения">
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:T.g400, marginBottom:6 }}>
                <span>Этап {o.activeStage} из 14: {STAGES[o.activeStage-1].name}</span>
                <span style={{ fontFamily:T.fontMono, fontWeight:600, color:T.org }}>{o.progress}%</span>
              </div>
              <div style={{ height:6, background:T.g600, borderRadius:3, overflow:"hidden" }}>
                <div style={{ height:"100%", width:`${o.progress}%`, background:`linear-gradient(90deg,${T.org},#FF9500)`, borderRadius:3, transition:"width .6s" }}/>
              </div>
            </InfoCard>
            <InfoCard title="Ответственные">
              <InfoRow label="Техник"          value={o.tech}/>
              <InfoRow label="Менеджер"        value="Ольга Д."/>
              <InfoRow label="Контроль качества" value="Иван Ж."/>
            </InfoCard>
          </div>
        )}

        {/* ── ТАБ ТАЙМЛАЙН ── */}
        {activeTab==="timeline" && (
          <div style={{ padding:"16px 22px 24px" }}>
            <div style={{ fontSize:9, fontWeight:700, letterSpacing:2, color:T.g400, textTransform:"uppercase", marginBottom:18 }}>
              📍 Этапность выполнения · 14 этапов
            </div>
            {STAGES.map((stage, idx)=>(
              <TimelineItem key={idx} stage={stage} stageNum={idx+1} order={o} isLast={idx===13} onAction={onAction}/>
            ))}
          </div>
        )}

        {/* ── ТАБ ФАЙЛЫ ── */}
        {activeTab==="files" && (
          <div style={{ padding:"14px 22px" }}>
            <InfoCard title={`Прикреплённые файлы (${(o.files||[]).length})`}>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, marginTop:8 }}>
                {(o.files||[]).map((f,i)=>(
                  <div key={i} style={{ background:T.g600, border:`1px solid ${T.g550}`, borderRadius:6, padding:"10px 8px", textAlign:"center", cursor:"pointer", fontSize:10, color:T.g200, transition:"all .15s" }}
                    onMouseOver={e=>{e.currentTarget.style.borderColor=T.org;e.currentTarget.style.color=T.white}}
                    onMouseOut={e=>{e.currentTarget.style.borderColor=T.g550;e.currentTarget.style.color=T.g200}}>
                    <div style={{ fontSize:22, marginBottom:5 }}>{f.i}</div>
                    <div style={{ fontSize:9, wordBreak:"break-all", color:T.g300 }}>{f.n}</div>
                  </div>
                ))}
              </div>
            </InfoCard>
            <div style={{ border:`2px dashed ${T.g550}`, borderRadius:8, padding:18, textAlign:"center", cursor:"pointer", color:T.g400, fontSize:11, marginTop:12 }}
              onMouseOver={e=>{e.currentTarget.style.borderColor=T.org;e.currentTarget.style.color=T.g200}}
              onMouseOut={e=>{e.currentTarget.style.borderColor=T.g550;e.currentTarget.style.color=T.g400}}>
              <div style={{ fontSize:24, marginBottom:6 }}>📂</div>
              <div>Добавить файл · <span style={{ color:T.org }}>STL · DICOM · JPG · PDF</span></div>
              <div style={{ fontSize:9, color:T.g500, marginTop:4 }}>до 500 МБ</div>
            </div>
          </div>
        )}

        {/* ── ТАБ КОММЕНТАРИИ ── */}
        {activeTab==="comments" && (
          <div style={{ padding:"14px 22px 24px", display:"flex", flexDirection:"column", gap:10 }}>
            {(o.comments||[]).length===0 ? (
              <div style={{ textAlign:"center", padding:"40px 0", color:T.g400 }}>
                <div style={{ fontSize:30, marginBottom:10 }}>💬</div>
                <div style={{ fontWeight:600, color:T.g300 }}>Комментариев пока нет</div>
              </div>
            ) : (o.comments||[]).map((c,i)=>(
              <div key={i} style={{ display:"flex", gap:9 }}>
                <div style={{
                  width:28, height:28, borderRadius:"50%", flexShrink:0,
                  display:"flex", alignItems:"center", justifyContent:"center",
                  fontSize:10, fontWeight:700,
                  background: c.role==="admin" ? T.orgD : c.role==="tech" ? "rgba(59,130,246,.15)" : "rgba(34,197,94,.15)",
                  border: `1px solid ${c.role==="admin" ? T.orgG : c.role==="tech" ? "rgba(59,130,246,.3)" : "rgba(34,197,94,.3)"}`,
                  color: c.role==="admin" ? T.org : c.role==="tech" ? T.blue : T.green,
                }}>{c.av}</div>
                <div style={{ flex:1, background:T.g700, border:`1px solid ${T.g600}`, borderRadius:"3px 8px 8px 8px", padding:"9px 12px" }}>
                  <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:5 }}>
                    <span style={{ fontSize:11, fontWeight:600 }}>{c.author}</span>
                    <span style={{ fontSize:9, color:T.g400, background:T.g600, padding:"1px 5px", borderRadius:3 }}>{c.role==="admin"?"Администратор":c.role==="tech"?"Техник":"Врач"}</span>
                    <span style={{ fontSize:9, fontFamily:T.fontMono, color:T.g500, marginLeft:"auto" }}>{c.time}</span>
                  </div>
                  <div style={{ fontSize:11, color:T.g200, lineHeight:1.6 }}>{c.text}</div>
                </div>
              </div>
            ))}
            <div ref={commentsEndRef}/>
            <div style={{ display:"flex", gap:8, alignItems:"flex-end", marginTop:4 }}>
              <textarea value={commentText} onChange={e=>setCommentText(e.target.value)}
                placeholder="Напишите технику, менеджеру или врачу..."
                onKeyDown={e=>{ if(e.key==="Enter"&&(e.ctrlKey||e.metaKey)) onSendComment(); }}
                style={{ flex:1, background:T.g700, border:`1px solid ${T.g600}`, borderRadius:7, padding:"9px 12px", color:T.white, fontFamily:T.fontMain, fontSize:12, resize:"none", minHeight:60, outline:"none" }}
                onFocus={e=>e.target.style.borderColor=T.org} onBlur={e=>e.target.style.borderColor=T.g600}/>
              <button onClick={onSendComment} style={{ background:T.org, border:"none", color:"#fff", width:36, height:36, borderRadius:7, fontSize:16, cursor:"pointer", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center" }}
                onMouseOver={e=>e.currentTarget.style.background="#D45A10"} onMouseOut={e=>e.currentTarget.style.background=T.org}
                title="Ctrl+Enter">↑</button>
            </div>
            <div style={{ fontSize:9, color:T.g500, textAlign:"right" }}>Ctrl+Enter для отправки</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── TIMELINE ITEM ─────────────────────────────────────────────────────────────
function TimelineItem({ stage, stageNum, order: o, isLast, onAction }) {
  const isDone    = stageNum < o.activeStage;
  const isActive  = stageNum === o.activeStage;
  const isPending = stageNum > o.activeStage;
  const isWarning = isActive && o.needsData && stage.warning;

  const dotBg    = isWarning ? "rgba(234,179,8,.15)" : isDone ? "rgba(34,197,94,.15)" : isActive ? T.orgD : T.g700;
  const dotBorder= isWarning ? T.yellow : isDone ? T.green : isActive ? T.org : T.g600;
  const dotShadow= isActive ? `0 0 12px ${T.orgG}` : "none";
  const connColor= isDone ? "rgba(34,197,94,.35)" : isActive ? `linear-gradient(to bottom,${T.org},${T.g600})` : T.g700;

  const nameColor= isWarning ? T.yellow : isDone ? T.g300 : isActive ? T.white : T.g500;

  return (
    <div style={{ display:"flex", gap:12 }}>
      {/* Левая колонка */}
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", width:28, flexShrink:0 }}>
        <div style={{
          width:26, height:26, borderRadius:"50%", border:`2px solid ${dotBorder}`,
          background:dotBg, boxShadow:dotShadow,
          display:"flex", alignItems:"center", justifyContent:"center",
          fontSize: isDone?13:10, flexShrink:0, zIndex:2, position:"relative"
        }}>
          {isDone ? "✓" : stage.emoji}
        </div>
        {!isLast && (
          <div style={{
            width:2, flex:1, minHeight:20, margin:"2px 0", borderRadius:1,
            background: isDone ? "rgba(34,197,94,.35)" : isActive ? `linear-gradient(to bottom,${T.org},${T.g600})` : T.g700
          }}/>
        )}
      </div>

      {/* Контент */}
      <div style={{ flex:1, paddingBottom:isLast?0:18 }}>
        {/* Строка заголовка */}
        <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:3, minHeight:26 }}>
          <div style={{ fontSize:12, fontWeight:600, lineHeight:1.3, color:nameColor }}>{stage.name}</div>
          {isActive && (
            <div style={{ display:"inline-flex", alignItems:"center", gap:4, fontSize:8, fontWeight:700, letterSpacing:.8, color:T.org, background:T.orgD, border:`1px solid ${T.orgG}`, padding:"2px 6px", borderRadius:10, textTransform:"uppercase" }}>
              <span style={{ width:5, height:5, borderRadius:"50%", background:T.org, animation:"pulse 1.8s infinite", display:"block" }}/>
              АКТИВНЫЙ
            </div>
          )}
          {isDone && (
            <span style={{ marginLeft:"auto", fontFamily:T.fontMono, fontSize:9, color:T.g500 }}>
              {daysAgo(o.activeStage - stageNum)}
            </span>
          )}
          {isActive && (
            <span style={{ marginLeft:"auto", fontFamily:T.fontMono, fontSize:9, color:T.org }}>сейчас</span>
          )}
        </div>

        {/* Описание */}
        {!isPending && (
          <div style={{ fontSize:10, color: isActive ? T.g200 : T.g400, lineHeight:1.6, marginBottom:stage.subs.length?7:0 }}>{stage.desc}</div>
        )}

        {/* Подпункты */}
        {!isPending && stage.subs.length > 0 && (
          <div style={{ display:"flex", flexDirection:"column", gap:4, marginBottom:8 }}>
            {stage.subs.map((s,i)=>{
              const subDone = isDone || (isActive && i < Math.ceil(stage.subs.length/2));
              return (
                <div key={i} style={{ display:"flex", alignItems:"center", gap:6, fontSize:10, color: subDone ? T.g300 : T.g500 }}>
                  <div style={{
                    width:14, height:14, borderRadius:"50%", flexShrink:0,
                    display:"flex", alignItems:"center", justifyContent:"center",
                    fontSize:8, border:`1.5px solid ${subDone ? T.green : T.g600}`,
                    background: subDone ? "rgba(34,197,94,.15)" : T.g700,
                    color: subDone ? T.green : "transparent"
                  }}>{subDone?"✓":""}</div>
                  {s}
                </div>
              );
            })}
          </div>
        )}

        {/* Действия для активного этапа */}
        {isActive && <StageActions stage={stage} order={o} stageNum={stageNum} onAction={onAction}/>}
      </div>
    </div>
  );
}

function StageActions({ stage, order: o, stageNum, onAction }) {
  if (stage.warning && o.needsData) {
    return (
      <div style={{ display:"flex", gap:7, marginTop:8, flexWrap:"wrap" }}>
        <TlBtn color="warning" onClick={()=>onAction("needsData",o.id)}>⚠️ Требуются данные</TlBtn>
        <TlBtn color="secondary" onClick={()=>{}}>✉️ Написать врачу</TlBtn>
      </div>
    );
  }
  if (stage.approval) {
    return (
      <div style={{ background:T.g700, border:`1px solid ${T.g600}`, borderRadius:8, padding:12, marginTop:8 }}>
        <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:11, fontWeight:600, color:T.yellow, marginBottom:6 }}>⏳ Ожидает согласования врача</div>
        <div style={{ fontSize:10, color:T.g400, marginBottom:10 }}>3D-визуализация отправлена на email и Telegram врача {o.doctor}</div>
        <div style={{ display:"flex", gap:7, flexWrap:"wrap" }}>
          <TlBtn color="success" onClick={()=>onAction("approved",o.id)}>✅ Согласовано</TlBtn>
          <TlBtn color="danger"  onClick={()=>onAction("revision",o.id)}>🔄 На доработку</TlBtn>
          <TlBtn color="secondary" onClick={()=>onAction("resend",o.id)}>📩 Повторно</TlBtn>
        </div>
      </div>
    );
  }
  if (stage.tracking) {
    return (
      <div style={{ marginTop:8 }}>
        <div style={{ background:T.g700, border:`1px solid ${T.g600}`, borderRadius:8, padding:"10px 12px", marginBottom:8 }}>
          <div style={{ fontSize:10, color:T.g300, marginBottom:3 }}>Трек-номер:</div>
          <div style={{ fontFamily:T.fontMono, fontSize:13, fontWeight:600, color:T.org }}>{o.trackingNum||"—"}</div>
          <div style={{ fontSize:10, color:T.g300, marginTop:3 }}>{o.trackingStatus||""}</div>
        </div>
        <div style={{ display:"flex", gap:7 }}>
          <TlBtn color="success" onClick={()=>onAction("received",o.id)}>✅ Клиника получила</TlBtn>
          <TlBtn color="purple"  onClick={()=>onAction("track",o.id)}>🔍 Отследить</TlBtn>
        </div>
      </div>
    );
  }
  if (stageNum < 13) {
    return (
      <div style={{ display:"flex", gap:7, marginTop:8, flexWrap:"wrap" }}>
        <TlBtn color="primary"   onClick={()=>onAction("next",o.id)}>Следующий этап →</TlBtn>
        <TlBtn color="secondary" onClick={()=>onAction("photo",o.id)}>📸 Добавить фото</TlBtn>
      </div>
    );
  }
  return null;
}

const BTN_STYLES = {
  primary:   { bg:T.org,                        text:"#fff" },
  secondary: { bg:T.g700,                        text:T.g200, border:`1px solid ${T.g600}` },
  warning:   { bg:"rgba(234,179,8,.1)",           text:T.yellow, border:"1px solid rgba(234,179,8,.3)" },
  danger:    { bg:"rgba(239,68,68,.1)",           text:T.red,    border:"1px solid rgba(239,68,68,.3)" },
  success:   { bg:"rgba(34,197,94,.1)",           text:T.green,  border:"1px solid rgba(34,197,94,.3)" },
  purple:    { bg:"rgba(168,85,247,.1)",          text:T.purple, border:"1px solid rgba(168,85,247,.3)" },
};

function TlBtn({ color="primary", onClick, children }) {
  const s = BTN_STYLES[color];
  const [hov, setHov] = useState(false);
  return (
    <button onClick={onClick}
      onMouseOver={()=>setHov(true)} onMouseOut={()=>setHov(false)}
      style={{
        padding:"6px 12px", borderRadius:5, fontFamily:T.fontMain,
        fontSize:11, fontWeight:600, cursor:"pointer", border:s.border||"none",
        background: hov && color==="primary" ? "#D45A10" : s.bg,
        color: s.text, transition:"all .2s",
      }}>{children}</button>
  );
}

function InfoCard({ title, children }) {
  return (
    <div style={{ background:T.g700, border:`1px solid ${T.g600}`, borderRadius:8, padding:"13px 14px", marginBottom:12 }}>
      <div style={{ fontSize:9, fontWeight:700, letterSpacing:2, textTransform:"uppercase", color:T.g400, marginBottom:10 }}>{title}</div>
      {children}
    </div>
  );
}

function InfoRow({ label, value, color }) {
  const textColor = color==="orange" ? T.org : color==="red" ? T.red : color==="green" ? T.green : T.white;
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"4px 0", borderBottom:`1px solid ${T.g600}` }}>
      <span style={{ fontSize:11, color:T.g400 }}>{label}</span>
      <span style={{ fontSize:11, fontWeight:600, color:textColor, textAlign:"right" }}>{value}</span>
    </div>
  );
}

function FormSection({ label, children }) {
  return (
    <div style={{ marginBottom:4 }}>
      <div style={{ fontSize:9, fontWeight:700, letterSpacing:2, color:T.g400, textTransform:"uppercase", marginBottom:12 }}>{label}</div>
      {children}
    </div>
  );
}

function FormDivider() {
  return <div style={{ height:1, background:T.g600, margin:"16px 0" }}/>;
}

function FInput({ label, placeholder, value, onChange, type="text" }) {
  return (
    <div style={{ marginBottom:13 }}>
      <label style={{ display:"block", fontSize:10, fontWeight:600, color:T.g300, letterSpacing:.5, marginBottom:5, textTransform:"uppercase" }}>{label}</label>
      <input type={type} value={value} placeholder={placeholder} onChange={e=>onChange(e.target.value)}
        style={{ width:"100%", background:T.g700, border:`1px solid ${T.g600}`, borderRadius:5, padding:"9px 11px", color:T.white, fontFamily:T.fontMain, fontSize:12, outline:"none" }}
        onFocus={e=>e.target.style.borderColor=T.org} onBlur={e=>e.target.style.borderColor=T.g600}/>
    </div>
  );
}

function FSelect({ label, value, onChange, options }) {
  return (
    <div style={{ marginBottom:13 }}>
      <label style={{ display:"block", fontSize:10, fontWeight:600, color:T.g300, letterSpacing:.5, marginBottom:5, textTransform:"uppercase" }}>{label}</label>
      <select value={value} onChange={e=>onChange(e.target.value)}
        style={{ width:"100%", background:T.g700, border:`1px solid ${T.g600}`, borderRadius:5, padding:"9px 11px", color:T.white, fontFamily:T.fontMain, fontSize:12, outline:"none", cursor:"pointer" }}
        onFocus={e=>e.target.style.borderColor=T.org} onBlur={e=>e.target.style.borderColor=T.g600}>
        {options.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </div>
  );
}
