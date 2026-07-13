export interface Partner {
  name: string
  type: 'BD Partner' | 'Partner' | 'SME'
  stage: 'GTM Active' | 'Business Referred' | 'Discussion Initiated'
  sbu: string
  spoc: string
  partner_spoc: string
  category: string
  willingness: string
  intro_quality: string
  comments: string
  last_meeting: string
  email: string
  actions: string[]
}

export interface LiveData {
  notes: string
  actions: string[]
  last_meeting: string
  report_url?: string
}

export interface WeeklyCell {
  US: number; India: number; MEA: number; Global: number; Unassigned: number
}

export interface WeekRow {
  week: string
  current: boolean
  note?: string
  cells: { 'BD Partner': WeeklyCell; Partner: WeeklyCell; SME: WeeklyCell }
}

export interface ReportRow extends Partner {
  live_notes: string
  live_actions: string[]
  live_last_meeting: string
}
