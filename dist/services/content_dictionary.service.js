"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const js_yaml_1 = __importDefault(require("js-yaml"));
class ContentDictionaryService {
    constructor() {
        this.DEFAULT_YAML = `terms:
  - canonical: "системный анализ"
    aliases: ["system analysis"]
    forbidden: ["сисан", "системный аналиz"]
    notes: "Используем русскую каноническую форму в публичном контенте."

style_rules:
  required_phrases: []
  forbidden_phrases:
    - "best practice без контекста"
  preferred_tone: "direct, practical, non-generic"`;
    }
    getDefaultYaml() {
        return this.DEFAULT_YAML;
    }
    parseYaml(rawYaml) {
        const source = (rawYaml || '').trim() || this.DEFAULT_YAML;
        const parsed = js_yaml_1.default.load(source);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('Dictionary must be a YAML object');
        }
        const dictionary = parsed;
        const terms = Array.isArray(dictionary.terms) ? dictionary.terms : [];
        const styleRules = dictionary.style_rules && typeof dictionary.style_rules === 'object'
            ? dictionary.style_rules
            : {};
        return {
            terms: terms.map((term, index) => {
                if (!term?.canonical || typeof term.canonical !== 'string') {
                    throw new Error(`terms[${index}].canonical is required`);
                }
                return {
                    canonical: term.canonical.trim(),
                    aliases: Array.isArray(term.aliases) ? term.aliases.map((value) => String(value).trim()).filter(Boolean) : [],
                    forbidden: Array.isArray(term.forbidden) ? term.forbidden.map((value) => String(value).trim()).filter(Boolean) : [],
                    notes: term.notes ? String(term.notes) : undefined
                };
            }),
            style_rules: {
                required_phrases: Array.isArray(styleRules.required_phrases)
                    ? styleRules.required_phrases.map((value) => String(value).trim()).filter(Boolean)
                    : [],
                forbidden_phrases: Array.isArray(styleRules.forbidden_phrases)
                    ? styleRules.forbidden_phrases.map((value) => String(value).trim()).filter(Boolean)
                    : [],
                preferred_tone: styleRules.preferred_tone ? String(styleRules.preferred_tone).trim() : undefined
            }
        };
    }
    normalizeToYaml(rawValue) {
        if (typeof rawValue === 'string') {
            this.parseYaml(rawValue);
            return rawValue.trim();
        }
        const serialized = js_yaml_1.default.dump(rawValue, {
            noRefs: true,
            lineWidth: 120
        });
        this.parseYaml(serialized);
        return serialized.trim();
    }
    validateText(text, dictionaryYaml) {
        const normalizedText = (text || '').trim();
        const findings = [];
        if (!dictionaryYaml?.trim()) {
            return {
                valid: true,
                score: 100,
                findings: [{
                        severity: 'info',
                        type: 'dictionary_missing',
                        message: 'Project dictionary is empty. Add YAML rules to validate terminology and consistency.'
                    }]
            };
        }
        const dictionary = this.parseYaml(dictionaryYaml);
        const haystack = normalizedText.toLowerCase();
        for (const phrase of dictionary.style_rules.forbidden_phrases) {
            if (haystack.includes(phrase.toLowerCase())) {
                findings.push({
                    severity: 'error',
                    type: 'forbidden_phrase',
                    message: `Forbidden phrase found: "${phrase}"`,
                    matched: phrase
                });
            }
        }
        for (const phrase of dictionary.style_rules.required_phrases) {
            if (!haystack.includes(phrase.toLowerCase())) {
                findings.push({
                    severity: 'warning',
                    type: 'required_phrase_missing',
                    message: `Required phrase is missing: "${phrase}"`,
                    suggestion: phrase
                });
            }
        }
        for (const term of dictionary.terms) {
            for (const forbidden of term.forbidden) {
                if (haystack.includes(forbidden.toLowerCase())) {
                    findings.push({
                        severity: 'error',
                        type: 'forbidden_term',
                        message: `Forbidden term variant found for "${term.canonical}"`,
                        matched: forbidden,
                        suggestion: term.canonical
                    });
                }
            }
            for (const alias of term.aliases) {
                if (haystack.includes(alias.toLowerCase())) {
                    findings.push({
                        severity: 'warning',
                        type: 'alias_used',
                        message: `Alias used instead of canonical term "${term.canonical}"`,
                        matched: alias,
                        suggestion: term.canonical
                    });
                }
            }
        }
        const errorCount = findings.filter((finding) => finding.severity === 'error').length;
        const warningCount = findings.filter((finding) => finding.severity === 'warning').length;
        const score = Math.max(0, 100 - errorCount * 25 - warningCount * 10);
        return {
            valid: errorCount === 0,
            score,
            findings
        };
    }
}
exports.default = new ContentDictionaryService();
