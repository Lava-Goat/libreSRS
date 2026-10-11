// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The verb dictionary: common Spanish verbs mapped to the model they
 * conjugate by.
 *
 * Spelling changes that follow from the ending alone (c>qu, g>gu, z>c, g>j,
 * gu>g, gu>gü, c>z, -uir i>y, vowel stems like leer/caer) are derived
 * automatically, so a verb only needs a flag for what cannot be seen in its
 * infinitive:
 *
 *   ie    e>ie in stressed syllables (pensar, entender, discernir)
 *   ue    o>ue (contar, volver); initial o>hue (oler), after g: güe (avergonzar)
 *   uue   u>ue (jugar)
 *   i     e>i (pedir): present stem, preterite 3rd persons, gerund, subjunctive
 *   iei   e>ie / e>i (sentir)
 *   ueu   o>ue / o>u (dormir, morir)
 *   iie   i>ie (adquirir)
 *   acc   stressed í/ú in the stem (enviar, continuar, reunir, prohibir)
 *   zc    c>zc before a/o (conocer, lucir)
 *   zcj   c>zc plus preterite -uj- (conducir, traducir)
 *   p=    irregular participle(s), '/'-separated, canonical first
 *   a=b   compound of b (obtener=tener): conjugated as b with the prefix
 *         added and the accents recomputed
 *
 * Fully irregular verbs are described in IRREGULAR as patches over the same
 * generator; compounds of them inherit the patch.
 */

import type { Person, Tense } from './types.js';

export type StemChange = 'ie' | 'ue' | 'uue' | 'i' | 'iei' | 'ueu' | 'iie' | 'acc';

/**
 * Overrides for irregular cells. Arrays of six hold one cell per person
 * (yo, tu, el, nosotros, vosotros, ellos); a cell may list alternatives
 * separated by '|', canonical first.
 */
export interface Patch {
  stem?: StemChange;
  /** Irregular present yo; also the stem of the present subjunctive. */
  yo?: string;
  present?: string[];
  subj?: string[];
  subjStem?: string;
  pret?: string[];
  /** Strong preterite stem (tuv-, hic-, dij-): -e, -iste, -o, -imos, -isteis, -ieron/-eron. */
  pretStem?: string;
  imperfect?: string[];
  /** Future / conditional stem(s), canonical first. */
  fut?: string[];
  impTu?: string[];
  impVos?: string[];
  impNos?: string[];
  /**
   * Voseo present / affirmative command where they are not the vosotros form
   * without its i / d (habláis → hablás, hablad → hablá): haber "has", ser
   * "sé", ir "andá".
   */
  vosPresent?: string[];
  impVoseo?: string[];
  gerund?: string[];
  participle?: string[];
  /** Also accept the regular (non stem-changing) forms: errar yerro / erro. */
  alsoRegular?: boolean;
}

const FUI = ['fui', 'fuiste', 'fue', 'fuimos', 'fuisteis', 'fueron'];

export const IRREGULAR: Record<string, Patch> = {
  ser: {
    present: ['soy', 'eres', 'es', 'somos', 'sois', 'son'],
    pret: FUI,
    imperfect: ['era', 'eras', 'era', 'éramos', 'erais', 'eran'],
    subj: ['sea', 'seas', 'sea', 'seamos', 'seáis', 'sean'],
    impTu: ['sé'],
    // DPD "voseo": the vos command of ser is sé, like tú's (not "sed" without d).
    impVoseo: ['sé'],
    gerund: ['siendo'],
    participle: ['sido'],
  },
  ir: {
    present: ['voy', 'vas', 'va', 'vamos', 'vais', 'van'],
    pret: FUI,
    imperfect: ['iba', 'ibas', 'iba', 'íbamos', 'ibais', 'iban'],
    subj: ['vaya', 'vayas', 'vaya', 'vayamos', 'vayáis', 'vayan'],
    impTu: ['ve'],
    impVos: ['id'],
    // NGLE §4.7: the vos command of ir is supplied by andar (andá, andate); "í" is not used.
    impVoseo: ['andá'],
    impNos: ['vamos', 'vayamos'],
    gerund: ['yendo'],
    participle: ['ido'],
  },
  estar: {
    present: ['estoy', 'estás', 'está', 'estamos', 'estáis', 'están'],
    pretStem: 'estuv',
    subj: ['esté', 'estés', 'esté', 'estemos', 'estéis', 'estén'],
    impTu: ['está'],
  },
  dar: {
    present: ['doy', 'das', 'da', 'damos', 'dais', 'dan'],
    pret: ['di', 'diste', 'dio', 'dimos', 'disteis', 'dieron'],
    subj: ['dé', 'des', 'dé', 'demos', 'deis', 'den'],
  },
  ver: {
    present: ['veo', 'ves', 've', 'vemos', 'veis', 'ven'],
    pret: ['vi', 'viste', 'vio', 'vimos', 'visteis', 'vieron'],
    imperfect: ['veía', 'veías', 'veía', 'veíamos', 'veíais', 'veían'],
    participle: ['visto'],
  },
  haber: {
    // "hay" (there is / there are) is the entry haber-impersonal, not a form of the auxiliary.
    present: ['he', 'has', 'ha', 'hemos', 'habéis', 'han'],
    pretStem: 'hub',
    fut: ['habr'],
    subj: ['haya', 'hayas', 'haya', 'hayamos', 'hayáis', 'hayan'],
    impTu: ['he'],
    // NGLE §4.7 / DPD "voseo": vos has (vos has visto); "habés" is rare and not accepted.
    vosPresent: ['has'],
  },
  saber: { yo: 'sé', subjStem: 'sep', pretStem: 'sup', fut: ['sabr'] },
  caber: { yo: 'quepo', pretStem: 'cup', fut: ['cabr'] },
  tener: { stem: 'ie', yo: 'tengo', pretStem: 'tuv', fut: ['tendr'], impTu: ['ten'] },
  venir: { stem: 'ie', yo: 'vengo', pretStem: 'vin', fut: ['vendr'], impTu: ['ven'], gerund: ['viniendo'] },
  poner: { yo: 'pongo', pretStem: 'pus', fut: ['pondr'], impTu: ['pon'], participle: ['puesto'] },
  salir: { yo: 'salgo', fut: ['saldr'], impTu: ['sal'] },
  hacer: { yo: 'hago', pretStem: 'hic', fut: ['har'], impTu: ['haz'], participle: ['hecho'] },
  decir: { stem: 'i', yo: 'digo', pretStem: 'dij', fut: ['dir'], impTu: ['di'], participle: ['dicho'] },
  traer: { yo: 'traigo', pretStem: 'traj' },
  caer: { yo: 'caigo' },
  // DLE "raer": raigo or rayo, and so raiga or raya through the subjunctive (vos raigás | rayás).
  raer: {
    present: ['raigo|rayo', 'raes', 'rae', 'raemos', 'raéis', 'raen'],
    subj: ['raiga|raya', 'raigas|rayas', 'raiga|raya', 'raigamos|rayamos', 'raigáis|rayáis', 'raigan|rayan'],
  },
  // DLE "asir": asgo, and so asga (vos asgás); every other form is regular.
  asir: { yo: 'asgo' },
  oír: { present: ['oigo', 'oyes', 'oye', 'oímos', 'oís', 'oyen'] },
  valer: { yo: 'valgo', fut: ['valdr'] },
  poder: { stem: 'ue', pretStem: 'pud', fut: ['podr'], gerund: ['pudiendo'] },
  querer: { stem: 'ie', pretStem: 'quis', fut: ['querr'] },
  andar: { pretStem: 'anduv' },
  reír: {
    present: ['río', 'ríes', 'ríe', 'reímos', 'reís', 'ríen'],
    pret: ['reí', 'reíste', 'rió', 'reímos', 'reísteis', 'rieron'],
    subj: ['ría', 'rías', 'ría', 'riamos', 'riáis', 'rían'],
    gerund: ['riendo'],
  },
  // Both "yerro" (general) and "erro" (common in the Americas) are accepted.
  errar: { stem: 'ie', alsoRegular: true },
  // DPD "erguir": two valid series where the stem is stressed, ye- (yergo,
  // more frequent today) and i- (irgo); unstressed stems close to i before a
  // or ió/ie (irgamos, irgáis, irguió, irguiendo), as in pedir. So the vos
  // subjunctive is irgás (from irgáis), and the vos present erguís.
  erguir: {
    stem: 'i',
    present: ['yergo|irgo', 'yergues|irgues', 'yergue|irgue', 'erguimos', 'erguís', 'yerguen|irguen'],
    subj: ['yerga|irga', 'yergas|irgas', 'yerga|irga', 'irgamos', 'irgáis', 'yergan|irgan'],
    impTu: ['yergue', 'irgue'],
  },
};

/** Patches applied on top of a compound's inherited forms. */
export const COMPOUND_PATCHES: Record<string, Patch> = {
  // DPD: the regular predeciré/predeciría is the majority form today; prediré is rare.
  // contradecir and desdecir keep the irregular form first (DPD lists it first).
  predecir: { impTu: ['predice'], fut: ['predecir', 'predir'] },
  contradecir: { impTu: ['contradice'], fut: ['contradir', 'contradecir'] },
  desdecir: { impTu: ['desdice'], fut: ['desdir', 'desdecir'] },
  bendecir: { impTu: ['bendice'], fut: ['bendecir'], participle: ['bendecido'] },
  maldecir: { impTu: ['maldice'], fut: ['maldecir'], participle: ['maldecido'] },
  satisfacer: { impTu: ['satisfaz', 'satisface'] },
  freír: { participle: ['frito', 'freído'] },
};

/**
 * Compounds whose base is spelled differently inside them: satisfacer is
 * satis- + the old "facer" (hacer with f).
 */
export const COMPOUND_SPECIAL: Record<string, { base: string; prefix: string; swapH: boolean }> = {
  satisfacer: { base: 'hacer', prefix: 'satis', swapH: true },
};

const RAW = `
abandonar abrazar acabar aceptar acercar acompañar aconsejar acostumbrar activar acusar adaptar
adelantar adivinar administrar admirar adoptar adorar afectar afeitar agarrar agitar agotar agradar
agregar aguantar ahorrar ajustar alabar alcanzar alegrar alejar alimentar aliviar almacenar alojar
alquilar alterar alumbrar amar amenazar analizar animar anotar anticipar anunciar apagar aparcar
aplicar apoyar apreciar apresurar aprovechar apuntar apurar arrancar arrastrar arreglar arrestar
arriesgar arrojar asar asegurar asomar aspirar asustar atacar atar atrapar aumentar autorizar
avanzar avisar ayudar ayunar bailar bajar bañar bautizar besar bordar borrar bostezar brillar brincar
brindar bromear broncear bucear burlar buscar cabalgar calcular calificar callar calmar cambiar
caminar cancelar cansar cantar capturar cargar casar castigar causar cazar celebrar cenar centrar
cepillar charlar chequear chocar circular citar clasificar cobrar cocinar colaborar coleccionar
colocar combinar comentar comparar compensar completar complicar comportar comprar comunicar
concentrar condenar conectar confirmar conquistar conservar considerar consultar contaminar
contestar contratar controlar conversar copiar coquetear cortar crear criticar cruzar cuestionar
cuidar culpar cultivar curar dañar danzar decepcionar declarar decorar dedicar dejar demandar
denunciar depositar derrotar desarrollar desayunar descansar descargar desear desempeñar desmayar
despegar destacar detectar determinar dibujar dictar disculpar diseñar disfrutar disgustar disparar
donar duchar durar echar editar educar ejercitar elaborar eliminar embarcar emocionar empacar
empeorar emplear empujar enamorar encantar encargar enfadar enfermar enfocar engañar engordar
enojar enseñar ensayar entrar entregar entrenar entrevistar entusiasmar equivocar escalar escapar
escuchar especializar esperar esquivar estacionar estimar estirar estornudar estudiar evitar exagerar
examinar excavar exclamar explicar explorar exportar expresar fabricar facilitar faltar fascinar
felicitar festejar fijar filmar finalizar firmar flotar fomentar formar fracasar frenar fumar
funcionar ganar garantizar gastar generar gozar grabar gritar guardar gustar habitar hablar halagar
hallar hospedar ilustrar imaginar imitar importar impresionar improvisar indicar informar iniciar
inspirar instalar intentar interesar inventar investigar invitar jubilar juntar jurar juzgar ladrar
lamentar lanzar lastimar lavar levantar liberar limitar limpiar llamar llegar llenar llevar llorar
lograr luchar madrugar malgastar mandar manejar maquillar marcar marchar masticar matar mejorar
mencionar mezclar mirar mojar molestar montar motivar mudar nadar narrar navegar necesitar negociar
nombrar notar observar obligar ocupar odiar olvidar opinar organizar pagar parar parquear participar
pasar pasear patinar pecar pegar peinar pelar pelear perdonar perjudicar pescar picar pintar pisar
planchar planear plantar platicar practicar precipitar preguntar preocupar preparar presentar prestar
privar proclamar programar pronunciar protestar publicar quedar quejar quemar quitar rascar realizar
recargar rechazar reciclar reclamar recuperar reemplazar regalar registrar regresar regular relajar
rellenar remar reparar repasar reservar respetar respirar restar resultar retirar retrasar revisar
rezar robar rodear sacar saltar saludar salvar sanar secar señalar separar significar simplificar
solicitar solucionar sospechar subrayar sudar sumar superar suspirar tardar telefonear terminar tirar
tocar tomar trabajar traicionar tranquilizar transformar trasladar tratar triunfar ubicar untar usar
utilizar vacilar valorar vendar verificar viajar vigilar visitar votar zarpar acostumbrar arrodillar
agachar apurar asociar atender:ie averiguar apaciguar atestiguar santiguar divorciar matricular
enterar esconder comprometer retirar mirar ocultar pintar rasurar pasar tostar:ue
cepillar alistar despeinar desmaquillar abrochar desabrochar cansar aburrir entretener=tener
emborrachar broncear acampar aterrizar despachar sembrar:ie secuestrar asaltar amanecer:zc
anochecer:zc atardecer:zc portar soportar importar reportar transportar
extrañar dudar ordenar pesar doblar girar hornear facturar abordar memorizar multiplicar deletrear
empatar patear batear trepar regatear fundar colonizar reutilizar desperdiciar ensuciar enchufar
desenchufar escanear fotocopiar recetar vacunar inyectar operar sangrar fracturar vomitar resbalar
rescatar enfrentar emigrar inmigrar archivar bloquear anular diagnosticar cursar aterrorizar
acostumbrar adornar aplastar arruinar cepillar cortejar cotizar charlar descubrir=cubrir
disminuir durar enfatizar ensayar entusiasmar estrenar evaluar:acc experimentar fallar fluir
gritar hervir:iei influir marcar mencionar observar pasar pegar presionar prestar rentar
saborear sonar:ue tapar tardar tejer temer traspasar votar

aprender barrer beber comer comprender correr coser creer deber depender emprender leer meter
ofender poseer prender prometer recorrer responder socorrer sorprender suceder temer toser vender
acceder anteceder ceder conceder exceder proceder retroceder sorber absorber arremeter cometer
entrometer someter corresponder tejer lamer pretender suspender desprender reprender releer
romper:p=roto proveer:p=provisto/proveído atrever

aburrir acudir admitir añadir aplaudir asistir asumir batir combatir compartir concurrir confundir
consistir consumir cumplir debatir decidir definir dimitir discutir dividir emitir escupir esgrimir
exhibir existir fundir hundir inhibir insistir interrumpir invadir partir percibir permitir persistir
persuadir presidir presumir recibir recurrir repartir residir resistir resumir subir sufrir suprimir
unir vivir ocurrir omitir oprimir deprimir reprimir exprimir transmitir coincidir difundir eludir
evadir sacudir transcurrir discurrir escurrir pulir aludir redimir eximir gruñir bullir zambullir
abrir:p=abierto cubrir:p=cubierto escribir:p=escrito describir:p=descrito inscribir:p=inscrito
suscribir:p=suscrito prescribir:p=prescrito transcribir:p=transcrito proscribir:p=proscrito
imprimir:p=impreso/imprimido reescribir=escribir descubrir=cubrir encubrir=cubrir recubrir=cubrir
reabrir=abrir entreabrir=abrir sobrevivir=vivir convivir=vivir revivir=vivir
zurcir esparcir resarcir dirigir exigir fingir surgir sumergir afligir rugir infligir erigir
coger escoger recoger acoger encoger proteger emerger distinguir extinguir delinquir
vencer convencer ejercer mecer

pensar:ie cerrar:ie empezar:ie comenzar:ie despertar:ie sentar:ie recomendar:ie calentar:ie nevar:ie
helar:ie gobernar:ie merendar:ie temblar:ie quebrar:ie manifestar:ie apretar:ie fregar:ie negar:ie
regar:ie plegar:ie desplegar:ie tropezar:ie encomendar:ie enterrar:ie acertar:ie atravesar:ie
confesar:ie encerrar:ie concertar:ie desconcertar:ie tentar:ie alentar:ie arrendar:ie remendar:ie
enmendar:ie cegar:ie segar:ie asentar:ie desterrar:ie reventar:ie escarmentar:ie sosegar:ie
restregar:ie renegar:ie denegar:ie serrar:ie mentar:ie
contar:ue encontrar:ue recordar:ue acordar:ue acostar:ue costar:ue mostrar:ue demostrar:ue probar:ue
comprobar:ue aprobar:ue desaprobar:ue reprobar:ue volar:ue sonar:ue soñar:ue tronar:ue rodar:ue
consolar:ue renovar:ue almorzar:ue forzar:ue esforzar:ue reforzar:ue colgar:ue descolgar:ue
rogar:ue soltar:ue avergonzar:ue apostar:ue volcar:ue poblar:ue recostar:ue colar:ue
concordar:ue resonar:ue sobrevolar:ue descontar=contar recontar=contar jugar:uue
entender:ie perder:ie encender:ie defender:ie tender:ie extender:ie descender:ie
ascender:ie verter:ie trascender:ie
volver:ue:p=vuelto mover:ue llover:ue doler:ue soler:ue morder:ue oler:ue torcer:ue retorcer:ue
cocer:ue resolver:ue:p=resuelto disolver:ue:p=disuelto absolver:ue:p=absuelto
devolver=volver envolver=volver revolver=volver desenvolver=volver
remover=mover promover=mover conmover=mover
pedir:i servir:i repetir:i seguir:i vestir:i medir:i competir:i elegir:i corregir:i regir:i gemir:i
rendir:i derretir:i concebir:i embestir:i teñir:i reñir:i ceñir:i desteñir:i expedir:i
despedir=pedir impedir=pedir conseguir=seguir perseguir=seguir proseguir=seguir desvestir=vestir
revestir=vestir reelegir=elegir
sentir:iei preferir:iei mentir:iei divertir:iei convertir:iei advertir:iei sugerir:iei herir:iei
hervir:iei requerir:iei referir:iei invertir:iei arrepentir:iei interferir:iei conferir:iei
diferir:iei digerir:iei inferir:iei transferir:iei pervertir:iei revertir:iei
consentir=sentir presentir=sentir resentir=sentir discernir:ie concernir:ie
dormir:ueu morir:ueu:p=muerto adquirir:iie inquirir:iie

enviar:acc reenviar:acc esquiar:acc confiar:acc desconfiar:acc fiar:acc guiar:acc criar:acc
vaciar:acc variar:acc ampliar:acc enfriar:acc resfriar:acc desafiar:acc espiar:acc desviar:acc
liar:acc rociar:acc fotografiar:acc ansiar:acc contrariar:acc extraviar:acc
actuar:acc acentuar:acc continuar:acc evaluar:acc graduar:acc situar:acc insinuar:acc efectuar:acc
exceptuar:acc habituar:acc perpetuar:acc puntuar:acc fluctuar:acc atenuar:acc devaluar:acc
tatuar:acc reunir:acc prohibir:acc cohibir:acc aislar:acc rehusar:acc aullar:acc ahumar:acc
maullar:acc aunar:acc ahijar:acc enraizar:acc degollar:ue rever=ver

conocer:zc reconocer:zc desconocer:zc parecer:zc aparecer:zc desaparecer:zc comparecer:zc
ofrecer:zc agradecer:zc merecer:zc nacer:zc renacer:zc crecer:zc obedecer:zc desobedecer:zc
establecer:zc restablecer:zc pertenecer:zc permanecer:zc favorecer:zc fortalecer:zc
enriquecer:zc empobrecer:zc envejecer:zc rejuvenecer:zc oscurecer:zc enloquecer:zc
entristecer:zc palidecer:zc padecer:zc carecer:zc estremecer:zc florecer:zc fallecer:zc
enternecer:zc compadecer:zc apetecer:zc abastecer:zc enorgullecer:zc embellecer:zc endurecer:zc
humedecer:zc prevalecer:zc enrojecer:zc aborrecer:zc acontecer:zc adormecer:zc complacer:zc
enfurecer:zc desvanecer:zc resplandecer:zc enmudecer:zc lucir:zc relucir:zc
conducir:zcj producir:zcj reproducir:zcj traducir:zcj reducir:zcj deducir:zcj introducir:zcj
inducir:zcj seducir:zcj aducir:zcj

construir destruir reconstruir contribuir distribuir atribuir retribuir incluir concluir excluir
recluir huir influir fluir confluir sustituir constituir restituir instituir destituir disminuir
instruir obstruir intuir diluir rehuir=huir

obtener=tener mantener=tener contener=tener detener=tener sostener=tener retener=tener
atener=tener abstener=tener
prevenir=venir convenir=venir intervenir=venir provenir=venir sobrevenir=venir devenir=venir
avenir=venir
componer=poner suponer=poner proponer=poner disponer=poner exponer=poner imponer=poner
oponer=poner reponer=poner posponer=poner descomponer=poner anteponer=poner deponer=poner
interponer=poner predisponer=poner sobreponer=poner transponer=poner contraponer=poner
recomponer=poner indisponer=poner yuxtaponer=poner
deshacer=hacer rehacer=hacer satisfacer
atraer=traer distraer=traer contraer=traer sustraer=traer extraer=traer retraer=traer
abstraer=traer decaer=caer recaer=caer sobresalir=salir equivaler=valer prever=ver entrever=ver
predecir=decir contradecir=decir desdecir=decir bendecir=decir maldecir=decir desoír=oír
sonreír=reír freír=reír engreír=reír refreír=freír

moler:ue demoler=moler soldar:ue remorder=morder escocer=cocer recocer=cocer adherir:iei ingerir:iei
malentender=entender desatender=atender colegir:i constreñir:i pudrir:p=podrido lloviznar granizar
relampaguear diluviar escarchar garuar:acc
`;

/**
 * Infinitives spelled two ways that conjugate identically. DPD "pudrir": every
 * form takes u (pudro, pudría, pudrió, pudriendo) except the participle podrido.
 */
export const ALIASES: Record<string, string> = { podrir: 'pudrir' };

/**
 * Defective verbs: the cells they lack. `conjugate` returns null there, so a
 * drill never asks for a form that does not exist.
 *  - soler (DPD): no future, conditional or imperative;
 *  - concernir (DPD): third persons only, no imperative;
 *  - estar: no progressive of itself ("estoy estando" is not taught as
 *    Spanish; the progressive is estar + gerund of another verb), so neither
 *    estar nor estarse drills presentProgressive — like haber-impersonal.
 */
export const DEFECTIVE: Record<string, { tenses?: Tense[]; persons?: Person[] }> = {
  soler: { tenses: ['future', 'conditional', 'imperativeAffirmative', 'imperativeNegative'] },
  concernir: { persons: ['el', 'ellos'], tenses: ['imperativeAffirmative', 'imperativeNegative'] },
  estar: { tenses: ['presentProgressive'] },
};

/**
 * Pronominal verbs recognised as such (analyze, detection). Any other verb
 * can still be conjugated with -se; these are the ones a course teaches.
 */
export const REFLEXIVE_VERBS: string[] = `
llamarse levantarse acostarse despertarse ducharse bañarse lavarse cepillarse peinarse afeitarse
maquillarse vestirse desvestirse ponerse quitarse secarse sentarse irse dormirse sentirse
divertirse aburrirse enojarse enfadarse preocuparse quedarse casarse mudarse graduarse reunirse
callarse caerse quejarse darse hacerse volverse convertirse acordarse olvidarse arrepentirse
atreverse burlarse cansarse comprometerse dedicarse despedirse enamorarse encontrarse enfermarse
equivocarse fijarse interesarse lastimarse marcharse morirse negarse parecerse portarse prepararse
probarse reírse relajarse romperse verse alegrarse asustarse broncearse calmarse comportarse
detenerse distraerse entrenarse estirarse perderse pasearse preguntarse quemarse recuperarse
resfriarse separarse tranquilizarse torcerse cortarse jubilarse retirarse matricularse enterarse
esforzarse oponerse dirigirse comunicarse acercarse alejarse esconderse arrodillarse agacharse
apurarse abrocharse divorciarse sonreírse mirarse conocerse mantenerse ejercitarse emocionarse
abstenerse atenerse inscribirse registrarse vestirse gustarse
`
  .trim()
  .split(/\s+/)
  .filter((v, i, a) => a.indexOf(v) === i);

/**
 * Verbs used like gustar: the subject is what is liked. Their bare
 * infinitive on a card ("encantar | to love (things)") is practiced as the
 * dative entry (encantarle).
 */
export const GUSTAR_TYPE = new Set([
  'gustar', 'encantar', 'interesar', 'importar', 'doler', 'faltar', 'molestar', 'fascinar',
  'disgustar', 'apetecer',
]);

/**
 * Verbs whose dative entry (-le: me gusta, le duele, nos queda) the reverse
 * index knows. Any verb can form one; these are the ones courses use in the
 * gustar construction.
 */
export const DATIVE_VERBS: string[] = `
gustar encantar interesar importar doler faltar molestar fascinar disgustar apetecer quedar parecer
aburrir preocupar tocar sobrar bastar convenir caer pasar agradar entusiasmar sorprender asustar
fastidiar costar chiflar
`
  .trim()
  .split(/\s+/);

/** Weather verbs: impersonal by nature, only the third person singular exists (NGLE §41.5). */
export const WEATHER_VERBS = new Set([
  'llover', 'lloviznar', 'nevar', 'granizar', 'diluviar', 'relampaguear', 'tronar', 'escarchar', 'garuar',
]);

/**
 * Verbs with an impersonal entry "<verb>-impersonal" besides their plain one:
 * haber (hay, había, hubo…), hacer in the weather (hace frío, hizo calor) and
 * the daybreak verbs when they mean the day itself (amanece | dawn breaks),
 * not a person (amanecí cansado).
 */
export const IMPERSONAL_BASES = new Set(['haber', 'hacer', 'amanecer', 'anochecer', 'atardecer']);

export interface LexiconEntry {
  inf: string;
  stem?: StemChange;
  zc?: boolean;
  uj?: boolean;
  participle?: string[];
  /** Compound: conjugated as `base` with `prefix` added. */
  base?: string;
  prefix?: string;
  swapH?: boolean;
  irregular?: boolean;
  /** Spelling variant of another dictionary verb (podrir → pudrir). */
  alias?: string;
  /** Also accept the forms of this stem change, after the canonical ones (adecuo | adecúo). */
  altStem?: StemChange;
  /** An -eír verb outside the dictionary: conjugated as reír with this root in place of r. */
  eirRoot?: string;
}

function parseLexicon(): Map<string, LexiconEntry> {
  const map = new Map<string, LexiconEntry>();
  for (const token of RAW.trim().split(/\s+/)) {
    const [head, ...flags] = token.split(':');
    const [inf, base] = head.split('=');
    const entry: LexiconEntry = map.get(inf) ?? { inf };
    if (base) {
      if (!inf.endsWith(base)) throw new Error(`lexicon: ${inf} does not end with ${base}`);
      entry.base = base;
      entry.prefix = inf.slice(0, inf.length - base.length);
    }
    for (const flag of flags) {
      if (flag === 'zc') entry.zc = true;
      else if (flag === 'zcj') {
        entry.zc = true;
        entry.uj = true;
      } else if (flag.startsWith('p=')) entry.participle = flag.slice(2).split('/');
      else if (['ie', 'ue', 'uue', 'i', 'iei', 'ueu', 'iie', 'acc'].includes(flag)) entry.stem = flag as StemChange;
      else throw new Error(`lexicon: unknown flag ${flag} on ${inf}`);
    }
    map.set(inf, entry);
  }
  for (const [inf, special] of Object.entries(COMPOUND_SPECIAL)) {
    map.set(inf, { inf, base: special.base, prefix: special.prefix, swapH: special.swapH });
  }
  for (const [inf, alias] of Object.entries(ALIASES)) map.set(inf, { inf, alias });
  for (const inf of Object.keys(IRREGULAR)) {
    const existing = map.get(inf);
    map.set(inf, { ...(existing ?? { inf }), irregular: true });
  }
  return map;
}

export const LEXICON: ReadonlyMap<string, LexiconEntry> = parseLexicon();

/** Every infinitive in the dictionary (non-pronominal form), in insertion order. */
export const LEXICON_INFINITIVES: readonly string[] = [...LEXICON.keys()];
