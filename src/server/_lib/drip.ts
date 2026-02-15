import { logger } from "~/_utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DripStep = {
    /** Number of days after the trigger event to send this email */
    delayDays: number;
    /** Template name matching a key in the templateRenderers registry */
    template: string;
    /** Email subject line */
    subject: string;
};

type DripCampaign = {
    /** Human-readable campaign name */
    name: string;
    /** Event that starts this campaign (e.g. "signup", "inactive_7d") */
    trigger: string;
    /** Ordered sequence of emails to send */
    steps: DripStep[];
};

type DripStepResult = {
    /** Template name to render */
    template: string;
    /** Subject line for the email */
    subject: string;
    /** Which step in the campaign (0-indexed) */
    stepIndex: number;
    /** Campaign this step belongs to */
    campaignName: string;
};

// ---------------------------------------------------------------------------
// Campaign Definitions
// ---------------------------------------------------------------------------

const campaigns: DripCampaign[] = [
    {
        name: "onboarding",
        trigger: "signup",
        steps: [
            {
                delayDays: 0,
                template: "welcome",
                subject: "Welcome to ISO — you're in",
            },
            {
                delayDays: 1,
                template: "complete-profile",
                subject: "Complete your profile — get 3x more bookings",
            },
            {
                delayDays: 3,
                template: "upload-portfolio",
                subject: "Your work speaks louder than your bio",
            },
            {
                delayDays: 5,
                template: "first-event",
                subject: "Post your first event or browse open calls",
            },
            {
                delayDays: 7,
                template: "make-connection",
                subject: "Photography is better together",
            },
            {
                delayDays: 14,
                template: "check-in",
                subject: "Hey, how's it going?",
            },
        ],
    },
    {
        name: "re-engagement",
        trigger: "inactive_7d",
        steps: [
            {
                delayDays: 7,
                template: "inactive-events",
                subject: "New events near you on ISO",
            },
            {
                delayDays: 14,
                template: "inactive-missing",
                subject: "Photographers are looking for you",
            },
            {
                delayDays: 30,
                template: "inactive-last-chance",
                subject: "We miss you on ISO",
            },
        ],
    },
    {
        name: "post-booking",
        trigger: "booking_completed",
        steps: [
            {
                delayDays: 0,
                template: "booking-completed",
                subject: "How'd the shoot go?",
            },
            {
                delayDays: 3,
                template: "referral-invite",
                subject: "Know someone who'd love ISO?",
            },
        ],
    },
    {
        name: "upgrade",
        trigger: "high_engagement",
        steps: [
            {
                delayDays: 0,
                template: "upgrade-pitch",
                subject: "You're getting popular on ISO",
            },
        ],
    },
    {
        name: "referral",
        trigger: "second_booking",
        steps: [
            {
                delayDays: 0,
                template: "referral-invite",
                subject: "Know someone who'd love ISO?",
            },
            {
                delayDays: 7,
                template: "referral-invite",
                subject: "Reminder: share ISO with a photographer friend",
            },
        ],
    },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get all defined drip campaigns.
 */
export function getCampaigns(): readonly DripCampaign[] {
    return campaigns;
}

/**
 * Get a specific campaign by name.
 */
export function getCampaign(name: string): DripCampaign | undefined {
    return campaigns.find((c) => c.name === name);
}

/**
 * Get campaigns that match a specific trigger event.
 */
export function getCampaignsByTrigger(trigger: string): DripCampaign[] {
    return campaigns.filter((c) => c.trigger === trigger);
}

/**
 * Given a campaign name and the number of days since the trigger event,
 * returns the drip step that should be sent, if any.
 *
 * This performs an exact match on delayDays. A cron job or queue worker
 * should call this once per day per user per active campaign.
 *
 * @param campaignName - Name of the campaign (e.g. "onboarding")
 * @param daysSinceTrigger - Number of days since the trigger event
 * @returns The drip step to send, or null if no step matches today
 *
 * @example
 * ```ts
 * const step = getDripStep("onboarding", 3);
 * if (step) {
 *   await sendTemplateEmail({
 *     email: user.email,
 *     subject: step.subject,
 *     template: step.template,
 *     props: { firstName: user.name, ... },
 *   });
 * }
 * ```
 */
export function getDripStep(
    campaignName: string,
    daysSinceTrigger: number
): DripStepResult | null {
    const campaign = getCampaign(campaignName);
    if (!campaign) {
        logger.warn("Unknown drip campaign requested", { campaignName });
        return null;
    }

    const stepIndex = campaign.steps.findIndex(
        (step) => step.delayDays === daysSinceTrigger
    );

    if (stepIndex === -1) {
        return null;
    }

    const step = campaign.steps[stepIndex]!;

    return {
        template: step.template,
        subject: step.subject,
        stepIndex,
        campaignName: campaign.name,
    };
}

/**
 * Get all steps for a campaign, useful for previewing the full sequence.
 */
export function getCampaignSteps(campaignName: string): DripStep[] {
    const campaign = getCampaign(campaignName);
    if (!campaign) {
        logger.warn("Unknown drip campaign requested", { campaignName });
        return [];
    }
    return [...campaign.steps];
}

/**
 * Check if a given day has any pending drip step for a campaign.
 * Useful for a cron job to quickly skip days with no emails.
 */
export function hasDripStepOnDay(
    campaignName: string,
    daysSinceTrigger: number
): boolean {
    return getDripStep(campaignName, daysSinceTrigger) !== null;
}

export type { DripCampaign, DripStep, DripStepResult };
