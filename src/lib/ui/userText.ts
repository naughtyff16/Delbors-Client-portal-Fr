import { Children, isValidElement, cloneElement, type ReactNode, type ReactElement } from 'react';

// Requirement / decision references (BR-06, DBL-GAT-003, Q-CLT-01, NFR-AUD-001, UC-07, WF-12, RPT-002 …) belong in the
// traceability documents, not on screen. User-facing text passes through here (UI/UX audit, internal codes).
const CODE = String.raw`(?:DBL|BR|NFR|RPT|SCR|SUP|US|UC|WF|FRS|Q|OBJ|BO|INT|ADR|SR)(?=[-A-Z]*[\d*])(?:-(?:[A-Z0-9]+|\*))+(?:…\d+)?`;
const PAREN = new RegExp(String.raw`\s*\((?=[^()]*\b${CODE})[^()]*\)`, 'g');
const BARE = new RegExp(String.raw`\s*(?:[·,;/]\s*)?\b${CODE}\b(?:\s*(?:/|,|and|&)\s*\b${CODE}\b)*`, 'g');

export function stripCodes(s: string) {
  if (!CODE_TEST.test(s)) return s; // untouched — keeps the spaces around inline values like "for {contract} stops"
  // Preserve the outer whitespace: this string may sit between other inline nodes.
  const lead = s.match(/^\s*/)![0], trail = s.match(/\s*$/)![0];
  const inner = s
    .replace(PAREN, '')
    .replace(BARE, '')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/\(\s*\)/g, '')
    .replace(/[·,]\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return inner ? `${lead}${inner}${trail}` : lead || trail ? ' ' : '';
}
const CODE_TEST = new RegExp(String.raw`\b${CODE}`);

/** Strips codes from plain strings, including strings nested in simple inline elements. */
export function userText(node: ReactNode): ReactNode {
  if (typeof node === 'string') return stripCodes(node);
  if (Array.isArray(node)) return Children.map(node, (c) => userText(c));
  if (isValidElement(node)) {
    const el = node as ReactElement<{ children?: ReactNode }>;
    if (typeof el.type === 'string' && el.props.children != null) return cloneElement(el, undefined, userText(el.props.children));
  }
  return node;
}
