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
  prospects: string[]
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

export interface WeeklyCellPartners {
  US: string[]; India: string[]; MEA: string[]; Global: string[]; Unassigned: string[]
}

export interface WeekRow {
  week: string
  current: boolean
  note?: string
  cells: { 'BD Partner': WeeklyCell; Partner: WeeklyCell; SME: WeeklyCell }
  cell_partners?: { 'BD Partner': WeeklyCellPartners; Partner: WeeklyCellPartners; SME: WeeklyCellPartners }
}

export interface ReportRow extends Partner {
  live_notes: string
  live_actions: string[]
  live_last_meeting: string
  manual_actions: string[]
  manual_prospects: string[]
}
