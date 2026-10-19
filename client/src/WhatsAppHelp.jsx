import { whatsAppHelpUrl } from "./public-links.js";

export default function WhatsAppHelp() {
  return <a className="whatsapp-help" href={whatsAppHelpUrl} target="_blank" rel="noopener noreferrer" aria-label="Ask me on WhatsApp">
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 19.5 2.5 21l1.2-4.5A9.5 9.5 0 1 1 5 19.5Z"/>
      <path d="m8 6 2 3-1.5 1.5a9 9 0 0 0 5 5L15 14l3 2c-1 5-12-1-12-7 0-2 1-3 2-3Z"/>
    </svg>
    <span>Ask me</span>
  </a>;
}
