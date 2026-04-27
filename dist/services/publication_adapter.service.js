"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class PublicationAdapterService {
    inferExecutionMode(account, action) {
        if (action.human_review) {
            return 'manual';
        }
        if (account.platform === 'tilda' && account.cms_api_enabled) {
            return 'automated';
        }
        if (account.platform === 'google_search_console') {
            return 'automated';
        }
        if (account.platform === 'reddit') {
            return action.human_review ? 'manual' : 'automated';
        }
        return 'manual';
    }
    buildAdapterConfig(accountRef, account, actionSamples = []) {
        const executionModes = Array.from(new Set(actionSamples.map((action) => this.inferExecutionMode(account, action))));
        return {
            adapter_kind: 'publication_source',
            account_ref: accountRef,
            platform: account.platform,
            account_type: account.type || 'unknown',
            role: account.role || null,
            execution_modes: executionModes.length > 0 ? executionModes : ['manual'],
            allowed_content_types: account.allowed_content_types || [],
            forbidden_content_types: account.forbidden_content_types || [],
            usage_rule: account.usage_rule || null,
            capability_flags: {
                api_publish: account.cms_api_enabled === true || account.platform === 'reddit' || account.platform === 'google_search_console',
                manual_handoff: account.platform === 'linkedin' || account.platform === 'medium' || account.platform === 'indiehackers' || account.platform === 'reddit',
                analytics_supported: account.platform === 'linkedin' || account.platform === 'reddit' || account.platform === 'google_search_console'
            },
            raw_account: account
        };
    }
    buildManualChecklist(action, resolvedContext) {
        const checklist = [
            `Post from account: ${resolvedContext.accountRef || 'specified account in plan'}`,
            'Use the prepared body exactly as provided unless human review explicitly approves a change.',
            'Attach the prepared image/carousel bundle if the action requires visuals.',
            'After posting, record the public URL back into the task.'
        ];
        if (action.parameters?.link_location === 'first_comment_only' && resolvedContext.linkUrl) {
            checklist.push(`Publish the first comment with this URL: ${resolvedContext.linkUrl}`);
        }
        if (action.channel === 'medium' && resolvedContext.linkUrl) {
            checklist.push(`Set the canonical/original publication URL to: ${resolvedContext.linkUrl}`);
        }
        return checklist;
    }
    deriveMonitoringPlan(action) {
        const postActions = action.post_actions || [];
        const verification = action.verification || [];
        return {
            needs_comment_monitoring: postActions.some((item) => item.type === 'start_comment_monitor'),
            needs_link_comment_verification: verification.some((item) => item.type === 'link_comment_present'),
            needs_live_check: verification.some((item) => item.type === 'post_live_check'),
            needs_analytics_collection: postActions.some((item) => String(item.type || '').includes('gsc') || String(item.type || '').includes('analytics'))
        };
    }
}
exports.default = new PublicationAdapterService();
