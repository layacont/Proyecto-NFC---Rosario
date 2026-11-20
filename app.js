/**
 * Rezo Católico Diario — Lógica principal de la aplicación (Vanilla ES6+)
 * Maneja preferencias persistentes (tema y tamaño de letra), navegación por pestañas,
 * detección automática y renderizado completo del Santo Rosario, carga dinámica con
 * respaldo garantizado del Evangelio del Día, Coronilla de la Divina Misericordia
 * y registro del Service Worker para lectura sin conexión.
 */

(function () {
  'use strict';

  // ============================================================================
  // 1. CONSTANTES Y UTILIDADES PURAS
  // ============================================================================

  const STORAGE_KEYS = Object.freeze({
    THEME: 'rezo_diario_theme',
    FONT_SIZE: 'rezo_diario_font_size',
  });

  const FONT_SIZES = Object.freeze(['sm', 'md', 'lg', 'xl']);
  const DEFAULT_FONT_SIZE = 'md';
  const DEFAULT_THEME = 'light';
  const GOSPEL_TIMEOUT_MS = 6000;

  const DAYS_ES = Object.freeze([
    'Domingo',
    'Lunes',
    'Martes',
    'Miércoles',
    'Jueves',
    'Viernes',
    'Sábado',
  ]);

  const MONTHS_ES = Object.freeze([
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre',
  ]);

  /**
   * Mapeo litúrgico tradicional por día de la semana (Date.prototype.getDay()):
   * 0 = Domingo (Gloriosos), 1 = Lunes (Gozosos), 2 = Martes (Dolorosos),
   * 3 = Miércoles (Gloriosos), 4 = Jueves (Luminosos),
   * 5 = Viernes (Dolorosos), 6 = Sábado (Gozosos).
   */
  const DAY_TO_MYSTERY = Object.freeze({
    0: 'gloriosos',
    1: 'gozosos',
    2: 'dolorosos',
    3: 'gloriosos',
    4: 'luminosos',
    5: 'dolorosos',
    6: 'gozosos',
  });

  /**
   * Devuelve la clave del grupo de misterios correspondiente al día de la semana (0-6).
   * @param {number} dayIndex - Índice devuelto por Date.getDay() (0 = Domingo a 6 = Sábado).
   * @returns {'gozosos'|'dolorosos'|'gloriosos'|'luminosos'}
   */
  function getMysteryKeyForDay(dayIndex) {
    if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6) {
      return 'gloriosos';
    }
    return DAY_TO_MYSTERY[dayIndex];
  }

  /**
   * Devuelve la clave del grupo de misterios correspondiente a una fecha dada.
   * @param {Date} [date=new Date()]
   * @returns {'gozosos'|'dolorosos'|'gloriosos'|'luminosos'}
   */
  function getMysteryKeyForDate(date = new Date()) {
    const target = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
    return getMysteryKeyForDay(target.getDay());
  }

  /**
   * Formatea una fecha en español con el día de la semana capitalizado.
   * Ejemplo: "Jueves, 19 de noviembre de 2026"
   * @param {Date} [date=new Date()]
   * @returns {string}
   */
  function formatSpanishDate(date = new Date()) {
    const target = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
    const weekday = DAYS_ES[target.getDay()];
    const day = target.getDate();
    const month = MONTHS_ES[target.getMonth()];
    const year = target.getFullYear();
    return `${weekday}, ${day} de ${month} de ${year}`;
  }

  /**
   * Formatea una fecha en formato YYYYMMDD para la API de Evangelizo.
   * @param {Date} [date=new Date()]
   * @returns {string}
   */
  function formatDateYMD(date = new Date()) {
    const target = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
    const year = String(target.getFullYear());
    const month = String(target.getMonth() + 1).padStart(2, '0');
    const day = String(target.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  /**
   * Lee de localStorage de manera segura (tolera modo privado o restricciones de Safari).
   * @param {string} key
   * @param {string} fallback
   * @returns {string}
   */
  function safeStorageGet(key, fallback) {
    try {
      const value = window.localStorage.getItem(key);
      return value !== null ? value : fallback;
    } catch (_err) {
      return fallback;
    }
  }

  /**
   * Escribe en localStorage de manera segura.
   * @param {string} key
   * @param {string} value
   */
  function safeStorageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (_err) {
      // Silencioso en navegación privada o almacenamiento restringido
    }
  }

  /**
   * Crea un elemento DOM con clase y texto opcionales usando textContent (seguro contra XSS).
   * @param {string} tag
   * @param {string} [className]
   * @param {string} [text]
   * @returns {HTMLElement}
   */
  function createEl(tag, className, text) {
    const el = document.createElement(tag);
    if (className) {
      el.className = className;
    }
    if (typeof text === 'string') {
      el.textContent = text;
    }
    return el;
  }

  // ============================================================================
  // 2. TEXTOS LITÚRGICOS COMPLETOS EN ESPAÑOL
  // ============================================================================

  const COMMON_PRAYERS = Object.freeze({
    signOfCross: {
      title: 'Señal de la Cruz',
      text:
        'Por la señal de la Santa Cruz, de nuestros enemigos líbranos, Señor, Dios nuestro. ' +
        'En el nombre del Padre, y del Hijo, y del Espíritu Santo. Amén.',
    },
    actOfContrition: {
      title: 'Acto de Contrición',
      text:
        'Señor mío, Jesucristo, Dios y Hombre verdadero, Creador, Padre y Redentor mío; ' +
        'por ser Tú quien eres, Bondad infinita, y porque te amo sobre todas las cosas, ' +
        'me pesa de todo corazón de haberte ofendido; también me pesa porque puedes castigarme ' +
        'con las penas del infierno. Ayudado de tu divina gracia, propongo firmemente nunca más pecar, ' +
        'confesarme y cumplir la penitencia que me fuere impuesta. Amén.',
    },
    apostlesCreed: {
      title: 'Credo de los Apóstoles',
      text:
        'Creo en Dios, Padre Todopoderoso, Creador del cielo y de la tierra. ' +
        'Creo en Jesucristo, su único Hijo, Nuestro Señor, que fue concebido por obra y gracia del Espíritu Santo, ' +
        'nació de Santa María Virgen, padeció bajo el poder de Poncio Pilato, fue crucificado, muerto y sepultado, ' +
        'descendió a los infiernos, al tercer día resucitó de entre los muertos, subió a los cielos y está sentado ' +
        'a la derecha de Dios, Padre Todopoderoso. Desde allí ha de venir a juzgar a vivos y muertos. ' +
        'Creo en el Espíritu Santo, la santa Iglesia católica, la comunión de los santos, el perdón de los pecados, ' +
        'la resurrección de la carne y la vida eterna. Amén.',
    },
    ourFather: {
      title: 'Padrenuestro',
      text:
        'Padre nuestro, que estás en el cielo, santificado sea tu Nombre; venga a nosotros tu Reino; ' +
        'hágase tu voluntad en la tierra como en el cielo. Danos hoy nuestro pan de cada día; ' +
        'perdona nuestras ofensas, como también nosotros perdonamos a los que nos ofenden; ' +
        'no nos dejes caer en la tentación, y líbranos del mal. Amén.',
    },
    hailMary: {
      title: 'Avemaría',
      text:
        'Dios te salve, María, llena eres de gracia; el Señor es contigo. ' +
        'Bendita Tú eres entre todas las mujeres, y bendito es el fruto de tu vientre, Jesús. ' +
        'Santa María, Madre de Dios, ruega por nosotros, pecadores, ahora y en la hora de nuestra muerte. Amén.',
    },
    gloryBe: {
      title: 'Gloria',
      text:
        'Gloria al Padre y al Hijo y al Espíritu Santo. ' +
        'Como era en el principio, ahora y siempre, por los siglos de los siglos. Amén.',
    },
    fatimaPrayer:
      'Oh Jesús mío, perdónanos nuestros pecados, líbranos del fuego del infierno, ' +
      'lleva al cielo a todas las almas, especialmente a las más necesitadas de tu misericordia.',
    salveRegina: {
      title: 'Salve Regina (Dios te salve, Reina y Madre)',
      text:
        'Dios te salve, Reina y Madre de misericordia, vida, dulzura y esperanza nuestra; Dios te salve. ' +
        'A Ti llamamos los desterrados hijos de Eva; a Ti suspiramos, gimiendo y llorando, en este valle de lágrimas. ' +
        'Ea, pues, Señora, abogada nuestra, vuelve a nosotros esos tus ojos misericordiosos; ' +
        'y después de este destierro, muéstranos a Jesús, fruto bendito de tu vientre. ' +
        '¡Oh clemente, oh piadosa, oh dulce Virgen María!',
      versicle: 'V. Ruega por nosotros, Santa Madre de Dios.',
      response: 'R. Para que seamos dignos de alcanzar las promesas de Nuestro Señor Jesucristo. Amén.',
    },
    rosaryClosingPrayer: {
      title: 'Oración final del Santo Rosario',
      text:
        'Oh Dios, cuyo Unigénito Hijo, con su vida, muerte y resurrección, nos alcanzó el premio de la salvación eterna: ' +
        'concédenos, a los que recordamos estos misterios del Santísimo Rosario de la Bienaventurada Virgen María, ' +
        'imitar lo que contienen y alcanzar lo que prometen. Por el mismo Jesucristo nuestro Señor. Amén.',
    },
  });

  const MYSTERY_GROUPS = Object.freeze({
    gozosos: {
      key: 'gozosos',
      label: 'Misterios Gozosos',
      daysLabel: 'Lunes y Sábado',
      items: [
        {
          number: '1.er Misterio Gozoso',
          title: 'La Encarnación del Hijo de Dios',
          citation: 'Lc 1, 26-38',
          meditation:
            'El ángel Gabriel anuncia a María que ha sido elegida para ser la Madre del Salvador. ' +
            'Con humildad y confianza plena en la palabra de Dios, María responde: ' +
            '«Hágase en mí según tu palabra». Pidamos la gracia de la humildad y la disponibilidad ante la voluntad divina.',
        },
        {
          number: '2.º Misterio Gozoso',
          title: 'La Visitación de Nuestra Señora a su prima Santa Isabel',
          citation: 'Lc 1, 39-56',
          meditation:
            'Llena del Espíritu Santo, María se pone en camino apresuradamente hacia las montañas de Judea ' +
            'para servir a su prima Isabel, quien la proclama bendita entre todas las mujeres. ' +
            'Pidamos la virtud de la caridad fraterna y el servicio generoso al prójimo.',
        },
        {
          number: '3.er Misterio Gozoso',
          title: 'El Nacimiento del Hijo de Dios en Belén',
          citation: 'Lc 2, 1-20',
          meditation:
            'En la sencillez de un pesebre, nace Jesús, la Luz del mundo, rodeado del amor de María y José ' +
            'y adorado por los pastores. Pidamos espíritu de pobreza evangélica y un corazón desprendido que sepa acoger al Señor.',
        },
        {
          number: '4.º Misterio Gozoso',
          title: 'La Presentación del Niño Jesús en el Templo',
          citation: 'Lc 2, 22-38',
          meditation:
            'María y José llevan al Niño al Templo para consagrarlo al Señor según la Ley. ' +
            'El anciano Simeón reconoce en Él la salvación prometida y anuncia a María que una espada atravesará su alma. ' +
            'Pidamos la gracia de la obediencia filial y la pureza de corazón.',
        },
        {
          number: '5.º Misterio Gozoso',
          title: 'El Niño Jesús perdido y hallado en el Templo',
          citation: 'Lc 2, 41-52',
          meditation:
            'Tras tres días de angustiosa búsqueda, María y José encuentran a Jesús en el Templo sentado entre los doctores, ' +
            'ocupado en las cosas de su Padre. Pidamos la perseverancia para buscar siempre a Cristo por encima de todo.',
        },
      ],
    },
    dolorosos: {
      key: 'dolorosos',
      label: 'Misterios Dolorosos',
      daysLabel: 'Martes y Viernes',
      items: [
        {
          number: '1.er Misterio Doloroso',
          title: 'La Oración de Jesús en el Huerto de Getsemaní',
          citation: 'Mt 26, 36-46',
          meditation:
            'Ante el peso de los pecados del mundo y la proximidad de la Pasión, Jesús ora al Padre con angustia mortal: ' +
            '«No se haga mi voluntad, sino la tuya». Pidamos el don de la oración vigilante y la aceptación confiada de la cruz.',
        },
        {
          number: '2.º Misterio Doloroso',
          title: 'La Flagelación de Nuestro Señor Jesucristo',
          citation: 'Jn 19, 1',
          meditation:
            'Por orden de Pilato, Jesús es atado a la columna y cruelmente azotado, sufriendo en su propio cuerpo ' +
            'el castigo que merecían nuestras culpas. Pidamos la mortificación de nuestros sentidos y el perdón por nuestros pecados.',
        },
        {
          number: '3.er Misterio Doloroso',
          title: 'La Coronación de espinas',
          citation: 'Mt 27, 27-31',
          meditation:
            'Los soldados trenzan una corona de espinas y la clavan sobre la frente del Rey de reyes, burlándose de su realeza. ' +
            'Pidamos humildad profunda para rechazar la soberbia y reparar las ofensas contra el Sagrado Corazón.',
        },
        {
          number: '4.º Misterio Doloroso',
          title: 'Jesús con la Cruz a cuestas camino del Calvario',
          citation: 'Jn 19, 17',
          meditation:
            'Agotado por los tormentos, Jesús carga el madero de la Cruz por las calles de Jerusalén y encuentra a su Madre afligida. ' +
            'Pidamos fortaleza y paciencia para llevar con amor nuestra cruz de cada día siguiendo sus huellas.',
        },
        {
          number: '5.º Misterio Doloroso',
          title: 'La Crucifixión y Muerte de Nuestro Señor Jesucristo',
          citation: 'Lc 23, 33-46',
          meditation:
            'Clavado en la Cruz entre dos malhechores, Jesús perdona a quienes lo crucifican, nos entrega a María como Madre ' +
            'y entrega su espíritu al Padre por nuestra salvación. Pidamos un amor agradecido y la gracia de la perseverancia final.',
        },
      ],
    },
    gloriosos: {
      key: 'gloriosos',
      label: 'Misterios Gloriosos',
      daysLabel: 'Miércoles y Domingo',
      items: [
        {
          number: '1.er Misterio Glorioso',
          title: 'La Resurrección del Señor',
          citation: 'Mc 16, 1-8',
          meditation:
            'Al alba del primer día de la semana, Cristo vence definitivamente al pecado y a la muerte saliendo glorioso del sepulcro. ' +
            'Pidamos una fe viva y firme en el Resucitado que renueve nuestra esperanza cristiana.',
        },
        {
          number: '2.º Misterio Glorioso',
          title: 'La Ascensión del Señor al Cielo',
          citation: 'Hch 1, 9-11',
          meditation:
            'Cuarenta días después de su Resurrección, Jesús bendice a sus discípulos y asciende al Cielo a la derecha del Padre, ' +
            'prometiendo permanecer con nosotros hasta el fin del mundo. Pidamos elevar nuestro corazón a los bienes eternos.',
        },
        {
          number: '3.er Misterio Glorioso',
          title: 'La Venida del Espíritu Santo sobre los Apóstoles',
          citation: 'Hch 2, 1-13',
          meditation:
            'Reunidos en oración junto a María en el Cenáculo, los Apóstoles reciben el fuego del Espíritu Santo, ' +
            'que los transforma en testigos valientes del Evangelio. Pidamos los siete dones del Espíritu Santo y celo apostólico.',
        },
        {
          number: '4.º Misterio Glorioso',
          title: 'La Asunción de la Santísima Virgen María al Cielo',
          citation: 'Ap 12, 1',
          meditation:
            'Concluido el curso de su vida terrena, la Madre de Dios es asunta en cuerpo y alma a la gloria celestial, ' +
            'como primicia de nuestra propia resurrección. Pidamos una sincera devoción mariana y la gracia de una santa muerte.',
        },
        {
          number: '5.º Misterio Glorioso',
          title: 'La Coronación de María Santísima como Reina de todo lo creado',
          citation: 'Ap 12, 1',
          meditation:
            'En el Cielo, la Santísima Trinidad corona a la Virgen María como Reina de los Ángeles y de todos los Santos, ' +
            'abogada e intercesora nuestra. Pidamos acudir siempre con filial confianza a su maternal protección.',
        },
      ],
    },
    luminosos: {
      key: 'luminosos',
      label: 'Misterios Luminosos',
      daysLabel: 'Jueves',
      items: [
        {
          number: '1.er Misterio Luminoso',
          title: 'El Bautismo de Jesús en el Jordán',
          citation: 'Mt 3, 13-17',
          meditation:
            'Al sumergirse Jesús en las aguas del Jordán, se abren los cielos, desciende el Espíritu Santo como paloma ' +
            'y la voz del Padre proclama: «Este es mi Hijo amado». Pidamos fidelidad a nuestras promesas bautismales.',
        },
        {
          number: '2.º Misterio Luminoso',
          title: 'La autorrevelación de Jesús en las bodas de Caná',
          citation: 'Jn 2, 1-12',
          meditation:
            'Por intercesión de María, que dice a los sirvientes «Haced lo que Él os diga», Jesús convierte el agua en vino ' +
            'y realiza su primer signo revelando su gloria. Pidamos confiar en la intercesión maternal de María.',
        },
        {
          number: '3.er Misterio Luminoso',
          title: 'El anuncio del Reino de Dios invitando a la conversión',
          citation: 'Mc 1, 14-15',
          meditation:
            'Jesús recorre Galilea proclamando la Buena Noticia: «El tiempo se ha cumplido y el Reino de Dios está cerca; ' +
            'convertíos y creed en el Evangelio». Pidamos un corazón sincero dispuesto a la conversión continua.',
        },
        {
          number: '4.º Misterio Luminoso',
          title: 'La Transfiguración de Jesús en el monte Tabor',
          citation: 'Lc 9, 28-36',
          meditation:
            'Ante Pedro, Santiago y Juan, el rostro de Jesús resplandece como el sol y el Padre invita a escucharlo. ' +
            'Pidamos la gracia de contemplar la luz de Cristo en nuestra vida diaria y escuchar su Palabra.',
        },
        {
          number: '5.º Misterio Luminoso',
          title: 'La Institución de la Eucaristía',
          citation: 'Mt 26, 26-29',
          meditation:
            'En la Última Cena, Jesús toma el pan y el cáliz y nos entrega su propio Cuerpo y su Sangre como alimento de vida eterna ' +
            'y memorial de su entrega. Pidamos un amor ardiente y reverente hacia el Santísimo Sacramento.',
        },
      ],
    },
  });

  const LORETO_LITANY = Object.freeze({
    title: 'Letanías Lauretanas de la Santísima Virgen María',
    opening: [
      ['Señor, ten piedad', 'Señor, ten piedad'],
      ['Cristo, ten piedad', 'Cristo, ten piedad'],
      ['Señor, ten piedad', 'Señor, ten piedad'],
      ['Cristo, óyenos', 'Cristo, óyenos'],
      ['Cristo, escúchanos', 'Cristo, escúchanos'],
      ['Dios, Padre celestial', 'Ten piedad de nosotros'],
      ['Dios, Hijo, Redentor del mundo', 'Ten piedad de nosotros'],
      ['Dios, Espíritu Santo', 'Ten piedad de nosotros'],
      ['Santísima Trinidad, un solo Dios', 'Ten piedad de nosotros'],
    ],
    marianInvocations: [
      'Santa María',
      'Santa Madre de Dios',
      'Santa Virgen de las Vírgenes',
      'Madre de Cristo',
      'Madre de la Iglesia',
      'Madre de la misericordia',
      'Madre de la divina gracia',
      'Madre de la esperanza',
      'Madre purísima',
      'Madre castísima',
      'Madre siempre virgen',
      'Madre inmaculada',
      'Madre amable',
      'Madre admirable',
      'Madre del buen consejo',
      'Madre del Creador',
      'Madre del Salvador',
      'Virgen prudentísima',
      'Virgen digna de veneración',
      'Virgen digna de alabanza',
      'Virgen poderosa',
      'Virgen clemente',
      'Virgen fiel',
      'Espejo de justicia',
      'Trono de la sabiduría',
      'Causa de nuestra alegría',
      'Vaso espiritual',
      'Vaso digno de honor',
      'Vaso insigne de devoción',
      'Rosa mística',
      'Torre de David',
      'Torre de marfil',
      'Casa de oro',
      'Arca de la Alianza',
      'Puerta del cielo',
      'Estrella de la mañana',
      'Salud de los enfermos',
      'Refugio de los pecadores',
      'Consuelo de los migrantes',
      'Consoladora de los afligidos',
      'Auxilio de los cristianos',
      'Reina de los Ángeles',
      'Reina de los Patriarcas',
      'Reina de los Profetas',
      'Reina de los Apóstoles',
      'Reina de los Mártires',
      'Reina de los Confesores',
      'Reina de las Vírgenes',
      'Reina de todos los Santos',
      'Reina concebida sin pecado original',
      'Reina asunta a los cielos',
      'Reina del Santísimo Rosario',
      'Reina de la familia',
      'Reina de la paz',
    ],
    marianResponse: 'Ruega por nosotros',
    agnusDei: [
      ['Cordero de Dios, que quitas el pecado del mundo', 'Perdónanos, Señor'],
      ['Cordero de Dios, que quitas el pecado del mundo', 'Escúchanos, Señor'],
      ['Cordero de Dios, que quitas el pecado del mundo', 'Ten piedad de nosotros'],
    ],
    versicle: 'V. Ruega por nosotros, Santa Madre de Dios.',
    response: 'R. Para que seamos dignos de alcanzar las promesas de Nuestro Señor Jesucristo.',
    closingPrayer:
      'Oración: Te rogamos nos concedas, Señor Dios nuestro, gozar de continua salud de alma y cuerpo, ' +
      'y por la gloriosa intercesión de la bienaventurada siempre Virgen María, vernos libres de las tristezas ' +
      'de la vida presente y disfrutar de las alegrías eternas. Por Cristo nuestro Señor. Amén.',
  });

  const CORONILLA_TEXTS = Object.freeze({
    threePmPrayer: {
      title: 'Oración opcional de las 3:00 p.m. (Hora de la Misericordia)',
      text:
        'Expiraste, Jesús, pero la fuente de vida brotó para las almas y el mar de misericordia ' +
        'se abrió para el mundo entero. Oh fuente de vida, insondable Misericordia Divina, ' +
        'abarca al mundo entero y derrámate sobre nosotros.',
      jaculatoria:
        'Oh Sangre y Agua, que brotaste del Corazón de Jesús como una fuente de misericordia para nosotros, en Ti confío. (3 veces)',
    },
    decadeOpening:
      'Padre Eterno, te ofrecemos el Cuerpo y la Sangre, el Alma y la Divinidad de Tu amadísimo Hijo, ' +
      'Nuestro Señor Jesucristo, como propiciación de nuestros pecados y los del mundo entero.',
    decadeRepeat: 'Por su dolorosa Pasión, ten misericordia de nosotros y del mundo entero.',
    trisagion: 'Santo Dios, Santo Fuerte, Santo Inmortal, ten piedad de nosotros y del mundo entero.',
    finalPrayer:
      'Oh Dios Eterno, en quien la misericordia es infinita y el tesoro de compasión inagotable, ' +
      'vuelve a nosotros Tu mirada bondadosa y aumenta Tu misericordia en nosotros, para que en momentos difíciles ' +
      'no nos desesperemos ni nos desanimemos, sino que, con gran confianza, nos sometamos a Tu santa voluntad, ' +
      'que es el Amor y la Misericordia mismos. Amén.',
    finalJaculatoria: 'Jesús, en Ti confío. (3 veces)',
    decadeLabels: ['1.ª Decena', '2.ª Decena', '3.ª Decena', '4.ª Decena', '5.ª Decena'],
  });

  // ============================================================================
  // 3. RENDERIZADO DE CONTENIDO (ROSARIO Y CORONILLA)
  // ============================================================================

  /**
   * Crea un bloque estándar de oración (.prayer-block).
   * @param {string} title
   * @param {string} text
   * @param {string} [note]
   * @returns {HTMLElement}
   */
  function buildPrayerBlock(title, text, note) {
    const block = createEl('article', 'prayer-block');
    block.appendChild(createEl('h3', 'prayer-title', title));
    block.appendChild(createEl('p', 'prayer-text', text));
    if (note) {
      block.appendChild(createEl('p', 'prayer-note', note));
    }
    return block;
  }

  /**
   * Renderiza las Letanías Lauretanas completas dentro de un contenedor .prayer-section.
   * @returns {HTMLElement}
   */
  function buildLitanySection() {
    const block = createEl('article', 'prayer-block');
    block.appendChild(createEl('h3', 'prayer-title', LORETO_LITANY.title));

    const list = createEl('div', 'litany-list');

    const appendRow = (invocation, response) => {
      const row = createEl('div', 'litany-row');
      row.appendChild(createEl('span', 'litany-invocation', invocation));
      row.appendChild(createEl('span', 'litany-response', response));
      list.appendChild(row);
    };

    LORETO_LITANY.opening.forEach(([inv, res]) => appendRow(inv, res));
    LORETO_LITANY.marianInvocations.forEach((inv) => appendRow(inv, LORETO_LITANY.marianResponse));
    LORETO_LITANY.agnusDei.forEach(([inv, res]) => appendRow(inv, res));

    block.appendChild(list);

    block.appendChild(createEl('p', 'prayer-note', LORETO_LITANY.versicle));
    block.appendChild(createEl('p', 'prayer-note', LORETO_LITANY.response));
    block.appendChild(createEl('p', 'prayer-text', LORETO_LITANY.closingPrayer));

    return block;
  }

  /**
   * Renderiza el Santo Rosario completo en formato de lectura continua vertical.
   * @param {HTMLElement} container
   * @param {'gozosos'|'dolorosos'|'gloriosos'|'luminosos'} mysteryKey
   */
  function renderRosario(container, mysteryKey) {
    if (!container) return;

    const group = MYSTERY_GROUPS[mysteryKey] || MYSTERY_GROUPS.gloriosos;
    const fragment = document.createDocumentFragment();

    // 1. Oraciones iniciales
    const introSection = createEl('section', 'prayer-section');
    introSection.appendChild(createEl('h2', 'section-heading', 'Oraciones iniciales'));
    introSection.appendChild(
      buildPrayerBlock(COMMON_PRAYERS.signOfCross.title, COMMON_PRAYERS.signOfCross.text)
    );
    introSection.appendChild(
      buildPrayerBlock(COMMON_PRAYERS.actOfContrition.title, COMMON_PRAYERS.actOfContrition.text)
    );
    introSection.appendChild(
      buildPrayerBlock(COMMON_PRAYERS.apostlesCreed.title, COMMON_PRAYERS.apostlesCreed.text)
    );
    introSection.appendChild(
      buildPrayerBlock(
        COMMON_PRAYERS.ourFather.title,
        COMMON_PRAYERS.ourFather.text,
        'Por las intenciones del Santo Padre y la Iglesia universal.'
      )
    );
    introSection.appendChild(
      buildPrayerBlock(
        'Tres Avemarías (por el aumento de la Fe, la Esperanza y la Caridad)',
        COMMON_PRAYERS.hailMary.text,
        'Rezar tres veces: 1.ª por el aumento de la Fe, 2.ª por el aumento de la Esperanza y 3.ª por el aumento de la Caridad.'
      )
    );
    introSection.appendChild(
      buildPrayerBlock(COMMON_PRAYERS.gloryBe.title, COMMON_PRAYERS.gloryBe.text)
    );
    fragment.appendChild(introSection);

    // 2. Los 5 Misterios del grupo seleccionado
    const mysteriesSection = createEl('section', 'prayer-section');
    mysteriesSection.appendChild(
      createEl('h2', 'section-heading', `${group.label} (${group.daysLabel})`)
    );

    group.items.forEach((mystery) => {
      const card = createEl('article', 'mystery-card');

      const header = createEl('div', 'mystery-header');
      header.appendChild(createEl('span', 'mystery-number', mystery.number));
      header.appendChild(createEl('h3', 'mystery-title', mystery.title));
      card.appendChild(header);

      card.appendChild(createEl('p', 'mystery-citation', `Cita bíblica: ${mystery.citation}`));
      card.appendChild(createEl('p', 'mystery-meditation', mystery.meditation));

      const cues = createEl('div', 'mystery-cues');
      cues.appendChild(
        createEl(
          'p',
          'prayer-note',
          'En este misterio: 1 Padrenuestro, 10 Avemarías, 1 Gloria y la Jaculatoria de Fátima.'
        )
      );
      cues.appendChild(
        createEl('p', 'prayer-text', `Jaculatoria de Fátima: «${COMMON_PRAYERS.fatimaPrayer}»`)
      );
      card.appendChild(cues);

      mysteriesSection.appendChild(card);
    });

    fragment.appendChild(mysteriesSection);

    // 3. Oraciones finales y Letanías Lauretanas completas
    const closingSection = createEl('section', 'prayer-section');
    closingSection.appendChild(createEl('h2', 'section-heading', 'Oraciones finales'));

    const salveBlock = buildPrayerBlock(
      COMMON_PRAYERS.salveRegina.title,
      COMMON_PRAYERS.salveRegina.text
    );
    salveBlock.appendChild(createEl('p', 'prayer-note', COMMON_PRAYERS.salveRegina.versicle));
    salveBlock.appendChild(createEl('p', 'prayer-note', COMMON_PRAYERS.salveRegina.response));
    closingSection.appendChild(salveBlock);

    closingSection.appendChild(
      buildPrayerBlock(
        COMMON_PRAYERS.rosaryClosingPrayer.title,
        COMMON_PRAYERS.rosaryClosingPrayer.text
      )
    );

    closingSection.appendChild(buildLitanySection());
    fragment.appendChild(closingSection);

    container.replaceChildren(fragment);
  }

  /**
   * Renderiza la Coronilla de la Divina Misericordia en lectura vertical continua.
   * @param {HTMLElement} container
   */
  function renderCoronilla(container) {
    if (!container) return;

    const fragment = document.createDocumentFragment();

    // 1. Oraciones iniciales
    const introSection = createEl('section', 'prayer-section');
    introSection.appendChild(createEl('h2', 'section-heading', 'Oraciones iniciales'));

    introSection.appendChild(
      buildPrayerBlock(COMMON_PRAYERS.signOfCross.title, COMMON_PRAYERS.signOfCross.text)
    );

    const threePmBlock = buildPrayerBlock(
      CORONILLA_TEXTS.threePmPrayer.title,
      CORONILLA_TEXTS.threePmPrayer.text,
      CORONILLA_TEXTS.threePmPrayer.jaculatoria
    );
    introSection.appendChild(threePmBlock);

    introSection.appendChild(
      buildPrayerBlock(COMMON_PRAYERS.ourFather.title, COMMON_PRAYERS.ourFather.text)
    );
    introSection.appendChild(
      buildPrayerBlock(COMMON_PRAYERS.hailMary.title, COMMON_PRAYERS.hailMary.text)
    );
    introSection.appendChild(
      buildPrayerBlock(COMMON_PRAYERS.apostlesCreed.title, COMMON_PRAYERS.apostlesCreed.text)
    );
    fragment.appendChild(introSection);

    // 2. Las 5 Decenas
    const decadesSection = createEl('section', 'prayer-section');
    decadesSection.appendChild(
      createEl('h2', 'section-heading', 'Las cinco decenas de la Coronilla')
    );

    CORONILLA_TEXTS.decadeLabels.forEach((label) => {
      const card = createEl('article', 'decade-card');
      card.appendChild(createEl('h3', 'decade-header', label));
      card.appendChild(
        createEl(
          'p',
          'decade-prayer',
          `En la cuenta grande (1 vez): «${CORONILLA_TEXTS.decadeOpening}»`
        )
      );
      card.appendChild(
        createEl(
          'p',
          'decade-repeat',
          `En las 10 cuentas pequeñas (10 veces): «${CORONILLA_TEXTS.decadeRepeat}»`
        )
      );
      decadesSection.appendChild(card);
    });

    fragment.appendChild(decadesSection);

    // 3. Conclusión y Oración final
    const closingSection = createEl('section', 'prayer-section');
    closingSection.appendChild(createEl('h2', 'section-heading', 'Conclusión de la Coronilla'));

    const conclusionBlock = createEl('article', 'prayer-block');
    conclusionBlock.appendChild(createEl('h3', 'prayer-title', 'Trisagio angélico (3 veces)'));
    conclusionBlock.appendChild(
      createEl('p', 'prayer-text', `«${CORONILLA_TEXTS.trisagion}» (3 veces)`)
    );
    conclusionBlock.appendChild(createEl('h3', 'prayer-title', 'Oración final'));
    conclusionBlock.appendChild(createEl('p', 'prayer-text', CORONILLA_TEXTS.finalPrayer));
    conclusionBlock.appendChild(
      createEl('p', 'decade-conclusion', CORONILLA_TEXTS.finalJaculatoria)
    );

    closingSection.appendChild(conclusionBlock);
    fragment.appendChild(closingSection);

    container.replaceChildren(fragment);
  }

  // ============================================================================
  // 4. EVANGELIO DEL DÍA (CARGA DINÁMICA + FALLBACK GARANTIZADO)
  // ============================================================================

  /**
   * Extrae párrafos de texto seguro desde HTML devuelto por la API externa usando DOMParser,
   * eliminando etiquetas, scripts y avisos de pie de página sin usar innerHTML en el documento.
   * @param {string} rawHtml
   * @returns {string[]}
   */
  function extractSafeParagraphs(rawHtml) {
    if (typeof rawHtml !== 'string' || !rawHtml.trim()) {
      return [];
    }

    const normalized = rawHtml
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6])>/gi, '\n\n');

    let textContent = '';
    if (typeof DOMParser !== 'undefined') {
      const doc = new DOMParser().parseFromString(normalized, 'text/html');
      doc.querySelectorAll('script, style, noscript').forEach((node) => node.remove());
      textContent = doc.body ? doc.body.textContent || '' : '';
    } else {
      textContent = normalized.replace(/<[^>]*>/g, ' ');
    }

    return textContent
      .split(/\n{2,}/)
      .map((para) => para.replace(/\s+/g, ' ').trim())
      .filter((para) => para.length > 0 && !/evangelizo\.org/i.test(para));
  }

  /**
   * Realiza un fetch con AbortController y timeout.
   * @param {string} url
   * @param {number} timeoutMs
   * @returns {Promise<string>}
   */
  async function fetchTextWithTimeout(url, timeoutMs) {
    const controller = new AbortController();
    const timerId = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.text();
    } finally {
      window.clearTimeout(timerId);
    }
  }

  /**
   * Renderiza la tarjeta de respaldo garantizado cuando falla la obtención del Evangelio.
   * @param {HTMLElement} container
   * @param {() => void} onRetry
   */
  function renderGospelFallback(container, onRetry) {
    const card = createEl('article', 'fallback-card');
    card.appendChild(createEl('h2', 'section-heading', 'Evangelio del Día'));
    card.appendChild(
      createEl(
        'p',
        'prayer-text',
        'No se pudo cargar automáticamente el Evangelio de hoy en este dispositivo ' +
          '(por falta de conexión o restricción del servicio externo). ' +
          'Puedes leerlo directamente en cualquiera de estas fuentes oficiales:'
      )
    );

    const actions = createEl('div', 'fallback-actions');

    const vaticanLink = createEl('a', 'btn-primary', 'Vatican News (Evangelio en español)');
    vaticanLink.href = 'https://www.vaticannews.va/es/evangelio-de-hoy.html';
    vaticanLink.target = '_blank';
    vaticanLink.rel = 'noopener noreferrer';
    actions.appendChild(vaticanLink);

    const evangelizoLink = createEl('a', 'btn-secondary', 'Abrir Evangelizo.org');
    evangelizoLink.href = 'https://evangelizo.org/';
    evangelizoLink.target = '_blank';
    evangelizoLink.rel = 'noopener noreferrer';
    actions.appendChild(evangelizoLink);

    const retryBtn = createEl('button', 'btn-retry', 'Reintentar carga');
    retryBtn.type = 'button';
    retryBtn.addEventListener('click', onRetry);
    actions.appendChild(retryBtn);

    card.appendChild(actions);
    container.replaceChildren(card);
  }

  /**
   * Renderiza el Evangelio obtenido correctamente.
   * @param {HTMLElement} container
   * @param {string} citation
   * @param {string[]} paragraphs
   */
  function renderGospelSuccess(container, citation, paragraphs) {
    const card = createEl('article', 'gospel-card');
    card.appendChild(createEl('h2', 'section-heading', 'Evangelio del Día'));
    card.appendChild(createEl('p', 'gospel-citation', citation));

    const textWrap = createEl('div', 'gospel-text');
    paragraphs.forEach((paragraph) => {
      textWrap.appendChild(createEl('p', '', paragraph));
    });
    card.appendChild(textWrap);

    card.appendChild(
      createEl('p', 'gospel-source', 'Fuente litúrgica: Evangelizo.org (lectura diaria en español).')
    );

    container.replaceChildren(card);
  }

  /**
   * Carga el Evangelio del día desde feed.evangelizo.org con respaldo garantizado ante cualquier fallo.
   * @param {HTMLElement} container
   * @param {Date} [date=new Date()]
   * @returns {Promise<boolean>} true si se cargó el Evangelio, false si se mostró fallback.
   */
  async function loadGospel(container, date = new Date()) {
    if (!container) return false;

    container.replaceChildren(
      createEl('p', 'gospel-loading', 'Cargando el Evangelio del día\u2026')
    );

    const ymd = formatDateYMD(date);
    const citationUrl = `https://feed.evangelizo.org/v2/reader.php?date=${ymd}&type=reading_lt&lang=SP&content=GSP`;
    const readingUrl = `https://feed.evangelizo.org/v2/reader.php?date=${ymd}&type=reading&lang=SP&content=GSP`;

    try {
      const [rawCitation, rawReading] = await Promise.all([
        fetchTextWithTimeout(citationUrl, GOSPEL_TIMEOUT_MS),
        fetchTextWithTimeout(readingUrl, GOSPEL_TIMEOUT_MS),
      ]);

      const citationParts = extractSafeParagraphs(rawCitation);
      const readingParagraphs = extractSafeParagraphs(rawReading);

      if (readingParagraphs.length === 0) {
        throw new Error('Respuesta vacía del servicio del Evangelio');
      }

      const citation = citationParts.join(' — ') || 'Evangelio según la liturgia del día';
      renderGospelSuccess(container, citation, readingParagraphs);
      return true;
    } catch (_err) {
      renderGospelFallback(container, () => {
        loadGospel(container, new Date());
      });
      return false;
    }
  }

  // ============================================================================
  // 5. CONTROLES DE CABECERA, PESTAÑAS Y SERVICE WORKER
  // ============================================================================

  /**
   * Aplica el tamaño de letra al elemento raíz y actualiza los botones y localStorage.
   * @param {'sm'|'md'|'lg'|'xl'} size
   * @param {{ dec: HTMLElement|null, reset: HTMLElement|null, inc: HTMLElement|null }} btns
   */
  function applyFontSize(size, btns) {
    const validSize = FONT_SIZES.includes(size) ? size : DEFAULT_FONT_SIZE;
    document.documentElement.dataset.fontSize = validSize;
    safeStorageSet(STORAGE_KEYS.FONT_SIZE, validSize);

    const setBtnState = (btn, active) => {
      if (!btn) return;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    };

    setBtnState(btns.dec, validSize === 'sm');
    setBtnState(btns.reset, validSize === 'md');
    setBtnState(btns.inc, validSize === 'lg' || validSize === 'xl');
  }

  /**
   * Aplica el tema ('light' o 'dark') al elemento raíz, actualiza meta theme-color,
   * icono/etiqueta del botón y guarda en localStorage.
   * @param {'light'|'dark'} theme
   * @param {HTMLElement|null} toggleBtn
   */
  function applyTheme(theme, toggleBtn) {
    const validTheme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = validTheme;
    safeStorageSet(STORAGE_KEYS.THEME, validTheme);

    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', validTheme === 'dark' ? '#161412' : '#1E3A5F');
    }

    if (toggleBtn) {
      const isDark = validTheme === 'dark';
      toggleBtn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
      toggleBtn.setAttribute(
        'aria-label',
        isDark ? 'Cambiar a modo de lectura claro' : 'Alternar modo de lectura nocturna'
      );
      toggleBtn.title = isDark ? 'Modo claro' : 'Modo nocturno';
      const iconSpan = toggleBtn.querySelector('span[aria-hidden="true"]');
      if (iconSpan) {
        iconSpan.textContent = isDark ? '☀️' : '🌙';
      } else {
        toggleBtn.textContent = isDark ? '☀️' : '🌙';
      }
    }
  }

  /**
   * Inicializa toda la aplicación en el DOM cuando está listo.
   */
  function initApp() {
    const now = new Date();

    // 1. Fecha actual en español
    const currentDateEl = document.getElementById('current-date');
    if (currentDateEl) {
      currentDateEl.textContent = formatSpanishDate(now);
    }

    // 2. Controles de tamaño de letra
    const fontBtns = {
      dec: document.getElementById('font-dec'),
      reset: document.getElementById('font-reset'),
      inc: document.getElementById('font-inc'),
    };
    const savedFontSize = safeStorageGet(STORAGE_KEYS.FONT_SIZE, DEFAULT_FONT_SIZE);
    applyFontSize(savedFontSize, fontBtns);

    if (fontBtns.dec) {
      fontBtns.dec.addEventListener('click', () => {
        const current = document.documentElement.dataset.fontSize || DEFAULT_FONT_SIZE;
        const idx = FONT_SIZES.indexOf(current);
        const nextSize = FONT_SIZES[Math.max(0, (idx === -1 ? 1 : idx) - 1)];
        applyFontSize(nextSize, fontBtns);
      });
    }
    if (fontBtns.reset) {
      fontBtns.reset.addEventListener('click', () => {
        applyFontSize(DEFAULT_FONT_SIZE, fontBtns);
      });
    }
    if (fontBtns.inc) {
      fontBtns.inc.addEventListener('click', () => {
        const current = document.documentElement.dataset.fontSize || DEFAULT_FONT_SIZE;
        const idx = FONT_SIZES.indexOf(current);
        const nextSize = FONT_SIZES[Math.min(FONT_SIZES.length - 1, (idx === -1 ? 1 : idx) + 1)];
        applyFontSize(nextSize, fontBtns);
      });
    }

    // 3. Alternancia de tema claro / nocturno
    const themeToggleBtn = document.getElementById('theme-toggle');
    const savedTheme = safeStorageGet(STORAGE_KEYS.THEME, DEFAULT_THEME);
    applyTheme(savedTheme, themeToggleBtn);

    if (themeToggleBtn) {
      themeToggleBtn.addEventListener('click', () => {
        const current = document.documentElement.dataset.theme;
        applyTheme(current === 'dark' ? 'light' : 'dark', themeToggleBtn);
      });
    }

    // 4. Tab 1: Santo Rosario (detección automática + selector manual)
    const mysterySelect = document.getElementById('mystery-select');
    const mysteryBadge = document.getElementById('mystery-auto-badge');
    const rosarioContainer = document.getElementById('rosario-content');

    const autoMysteryKey = getMysteryKeyForDate(now);
    const updateMysteryBadge = (selectedKey) => {
      if (!mysteryBadge) return;
      const group = MYSTERY_GROUPS[selectedKey] || MYSTERY_GROUPS.gloriosos;
      if (selectedKey === autoMysteryKey) {
        mysteryBadge.textContent = `Hoy: ${group.label}`;
      } else {
        mysteryBadge.textContent = `Selección manual · ${group.daysLabel}`;
      }
    };

    if (mysterySelect) {
      mysterySelect.value = autoMysteryKey;
      mysterySelect.addEventListener('change', (event) => {
        const chosenKey = event.target.value;
        updateMysteryBadge(chosenKey);
        renderRosario(rosarioContainer, chosenKey);
      });
    }
    updateMysteryBadge(autoMysteryKey);
    renderRosario(rosarioContainer, autoMysteryKey);

    // 5. Tab 3: Coronilla de la Divina Misericordia
    const coronillaContainer = document.getElementById('coronilla-content');
    renderCoronilla(coronillaContainer);

    // 6. Navegación fija de 3 pestañas y carga diferida del Evangelio
    const tabButtons = [
      document.getElementById('tab-rosario'),
      document.getElementById('tab-evangelio'),
      document.getElementById('tab-coronilla'),
    ].filter(Boolean);

    const panelsByTabId = {
      'tab-rosario': document.getElementById('panel-rosario'),
      'tab-evangelio': document.getElementById('panel-evangelio'),
      'tab-coronilla': document.getElementById('panel-coronilla'),
    };

    const evangelioContainer = document.getElementById('evangelio-content');
    let gospelLoadedOnce = false;

    const activateTab = (targetBtn) => {
      if (!targetBtn) return;

      tabButtons.forEach((btn) => {
        const isSelected = btn === targetBtn;
        btn.classList.toggle('active', isSelected);
        btn.setAttribute('aria-selected', isSelected ? 'true' : 'false');

        const panel = panelsByTabId[btn.id];
        if (panel) {
          panel.classList.toggle('active', isSelected);
          panel.hidden = !isSelected;
        }
      });

      if (targetBtn.id === 'tab-evangelio' && !gospelLoadedOnce) {
        gospelLoadedOnce = true;
        loadGospel(evangelioContainer, new Date());
      }
    };

    tabButtons.forEach((btn, idx) => {
      btn.addEventListener('click', () => activateTab(btn));
      btn.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        event.preventDefault();
        const delta = event.key === 'ArrowRight' ? 1 : -1;
        const nextIndex = (idx + delta + tabButtons.length) % tabButtons.length;
        tabButtons[nextIndex].focus();
        activateTab(tabButtons[nextIndex]);
      });
    });

    // 7. Registro del Service Worker para funcionamiento offline
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(() => {
          // Falla silenciosamente si el navegador o contexto actual no permite Service Workers
        });
      });
    }
  }

  // API pública de solo lectura para pruebas automatizadas y verificación
  const publicApi = Object.freeze({
    getMysteryKeyForDay,
    getMysteryKeyForDate,
    formatSpanishDate,
    formatDateYMD,
    extractSafeParagraphs,
    loadGospel,
    MYSTERY_GROUPS,
    LORETO_LITANY,
    COMMON_PRAYERS,
    CORONILLA_TEXTS,
  });

  if (typeof window !== 'undefined') {
    window.__REZO_APP__ = publicApi;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initApp);
    } else {
      initApp();
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = publicApi;
  }
})();
