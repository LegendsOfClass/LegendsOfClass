import th from './th.json';
import en from './en.json';
const dicts: Record<string, Record<string, string>> = { th, en };
let lang = localStorage.getItem('loce.lang') ?? 'th';
export function setLang(l: 'th' | 'en') { lang = l; localStorage.setItem('loce.lang', l); }
export function getLang() { return lang; }
export function t(key: string): string { return dicts[lang]?.[key] ?? dicts.en[key] ?? key; }
