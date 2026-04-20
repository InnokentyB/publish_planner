import yaml from 'js-yaml';

type DictionaryTerm = {
    canonical: string;
    aliases: string[];
    forbidden: string[];
    notes?: string;
};

type DictionaryRules = {
    required_phrases: string[];
    forbidden_phrases: string[];
    preferred_tone?: string;
};

type NormalizedDictionary = {
    terms: DictionaryTerm[];
    style_rules: DictionaryRules;
};

type ValidationFinding = {
    severity: 'error' | 'warning' | 'info';
    type: 'forbidden_term' | 'alias_used' | 'forbidden_phrase' | 'required_phrase_missing' | 'dictionary_missing';
    message: string;
    matched?: string;
    suggestion?: string;
};

class ContentDictionaryService {
    private readonly DEFAULT_YAML = `terms:
  - canonical: "системный анализ"
    aliases: ["system analysis"]
    forbidden: ["сисан", "системный аналиz"]
    notes: "Используем русскую каноническую форму в публичном контенте."

style_rules:
  required_phrases: []
  forbidden_phrases:
    - "best practice без контекста"
  preferred_tone: "direct, practical, non-generic"`;

    getDefaultYaml() {
        return this.DEFAULT_YAML;
    }

    parseYaml(rawYaml?: string | null): NormalizedDictionary {
        const source = (rawYaml || '').trim() || this.DEFAULT_YAML;
        const parsed = yaml.load(source);

        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('Dictionary must be a YAML object');
        }

        const dictionary = parsed as any;
        const terms = Array.isArray(dictionary.terms) ? dictionary.terms : [];
        const styleRules = dictionary.style_rules && typeof dictionary.style_rules === 'object'
            ? dictionary.style_rules
            : {};

        return {
            terms: terms.map((term: any, index: number) => {
                if (!term?.canonical || typeof term.canonical !== 'string') {
                    throw new Error(`terms[${index}].canonical is required`);
                }

                return {
                    canonical: term.canonical.trim(),
                    aliases: Array.isArray(term.aliases) ? term.aliases.map((value: any) => String(value).trim()).filter(Boolean) : [],
                    forbidden: Array.isArray(term.forbidden) ? term.forbidden.map((value: any) => String(value).trim()).filter(Boolean) : [],
                    notes: term.notes ? String(term.notes) : undefined
                };
            }),
            style_rules: {
                required_phrases: Array.isArray(styleRules.required_phrases)
                    ? styleRules.required_phrases.map((value: any) => String(value).trim()).filter(Boolean)
                    : [],
                forbidden_phrases: Array.isArray(styleRules.forbidden_phrases)
                    ? styleRules.forbidden_phrases.map((value: any) => String(value).trim()).filter(Boolean)
                    : [],
                preferred_tone: styleRules.preferred_tone ? String(styleRules.preferred_tone).trim() : undefined
            }
        };
    }

    normalizeToYaml(rawValue: unknown): string {
        if (typeof rawValue === 'string') {
            this.parseYaml(rawValue);
            return rawValue.trim();
        }

        const serialized = yaml.dump(rawValue, {
            noRefs: true,
            lineWidth: 120
        });
        this.parseYaml(serialized);
        return serialized.trim();
    }

    validateText(text: string, dictionaryYaml?: string | null) {
        const normalizedText = (text || '').trim();
        const findings: ValidationFinding[] = [];

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

export default new ContentDictionaryService();
