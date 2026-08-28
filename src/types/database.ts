// Types générés à la main d'après supabase/migrations/0001_init.sql.
// À remplacer par `npx supabase gen types typescript --linked` une fois le projet Supabase lié.

export type Position = "Goalkeeper" | "Defender" | "Midfielder" | "Attacker";
export type SeasonStatus = "upcoming" | "in_progress" | "finished";
export type MatchStatus = "scheduled" | "live" | "finished" | "postponed" | "cancelled";
export type PointsSourceType =
  | "match_score"
  | "match_scorer"
  | "season_top_scorer"
  | "season_top_assist"
  | "season_top3"
  | "season_bottom3"
  | "season_surprise"
  | "season_flop";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          username: string;
          avatar_url: string | null;
          is_admin: boolean;
          created_at: string;
          chat_last_read_at: string | null;
          favorite_team_id: number | null;
        };
        Insert: Partial<Database["public"]["Tables"]["profiles"]["Row"]> & { id: string; username: string };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Row"]>;
        Relationships: [];
      };
      invite_codes: {
        Row: {
          code: string;
          created_by: string | null;
          used_by: string | null;
          used_at: string | null;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["invite_codes"]["Row"]> & { code: string };
        Update: Partial<Database["public"]["Tables"]["invite_codes"]["Row"]>;
        Relationships: [];
      };
      leagues: {
        Row: {
          id: number;
          name: string;
          country: string;
          highlightly_league_id: number;
          football_data_id: number;
          football_data_code: string;
          logo_url: string | null;
          active: boolean;
        };
        Insert: Partial<Database["public"]["Tables"]["leagues"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["leagues"]["Row"]>;
        Relationships: [];
      };
      teams: {
        Row: {
          id: number;
          league_id: number;
          name: string;
          football_data_id: number;
          logo_url: string | null;
          prior_ppg: number | null;
        };
        Insert: Partial<Database["public"]["Tables"]["teams"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["teams"]["Row"]>;
        Relationships: [];
      };
      players: {
        Row: {
          id: number;
          team_id: number;
          name: string;
          position: Position;
          football_data_id: number;
          photo_url: string | null;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["players"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["players"]["Row"]>;
        Relationships: [];
      };
      seasons: {
        Row: {
          id: number;
          league_id: number;
          year: number;
          start_date: string;
          end_date: string | null;
          predictions_lock_at: string;
          status: SeasonStatus;
          actual_surprise_team_id: number | null;
          actual_flop_team_id: number | null;
          points_processed_at: string | null;
        };
        Insert: Partial<Database["public"]["Tables"]["seasons"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["seasons"]["Row"]>;
        Relationships: [];
      };
      matches: {
        Row: {
          id: number;
          league_id: number;
          season_id: number;
          football_data_id: number;
          home_team_id: number;
          away_team_id: number;
          kickoff_at: string;
          status: MatchStatus;
          home_score: number | null;
          away_score: number | null;
          points_processed_at: string | null;
          events_synced_at: string | null;
          favorite_team_id: number | null;
          odds_tier: 1 | 2 | 3 | 4 | 5 | null;
          matchday: number | null;
        };
        Insert: Partial<Database["public"]["Tables"]["matches"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["matches"]["Row"]>;
        Relationships: [];
      };
      match_result_tier_multipliers: {
        Row: { tier: 1 | 2 | 3 | 4 | 5; favorite_multiplier_pct: number; underdog_multiplier_pct: number };
        Insert: Partial<Database["public"]["Tables"]["match_result_tier_multipliers"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["match_result_tier_multipliers"]["Row"]>;
        Relationships: [];
      };
      match_goals: {
        Row: {
          id: number;
          match_id: number;
          team_id: number;
          player_id: number | null;
          assist_player_id: number | null;
          minute: number | null;
        };
        Insert: Partial<Database["public"]["Tables"]["match_goals"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["match_goals"]["Row"]>;
        Relationships: [];
      };
      player_scoring_tier: {
        Row: {
          id: number;
          player_id: number;
          season_id: number;
          tier: 1 | 2 | 3 | 4 | 5;
          goals_per_90: number | null;
          computed_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["player_scoring_tier"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["player_scoring_tier"]["Row"]>;
        Relationships: [];
      };
      point_config: {
        Row: { key: string; points: number; description: string | null };
        Insert: Partial<Database["public"]["Tables"]["point_config"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["point_config"]["Row"]>;
        Relationships: [];
      };
      match_scorer_tier_points: {
        Row: { tier: 1 | 2 | 3 | 4 | 5; points: number };
        Insert: Partial<Database["public"]["Tables"]["match_scorer_tier_points"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["match_scorer_tier_points"]["Row"]>;
        Relationships: [];
      };
      season_top_player_tier_points: {
        Row: { tier: 1 | 2 | 3 | 4 | 5; points: number };
        Insert: Partial<Database["public"]["Tables"]["season_top_player_tier_points"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["season_top_player_tier_points"]["Row"]>;
        Relationships: [];
      };
      app_settings: {
        Row: { key: string; value: string };
        Insert: Partial<Database["public"]["Tables"]["app_settings"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["app_settings"]["Row"]>;
        Relationships: [];
      };
      season_predictions: {
        Row: {
          id: number;
          user_id: string;
          season_id: number;
          top_scorer_player_id: number | null;
          top_assist_player_id: number | null;
          top3: Record<string, number>;
          bottom3: Record<string, number>;
          surprise_team_id: number | null;
          flop_team_id: number | null;
          submitted_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["season_predictions"]["Row"]> & {
          user_id: string;
          season_id: number;
        };
        Update: Partial<Database["public"]["Tables"]["season_predictions"]["Row"]>;
        Relationships: [];
      };
      match_predictions: {
        Row: {
          id: number;
          user_id: string;
          match_id: number;
          predicted_home_score: number;
          predicted_away_score: number;
          predicted_scorer_player_id: number | null;
          submitted_at: string;
          updated_at: string;
          points_awarded: number | null;
        };
        Insert: Partial<Database["public"]["Tables"]["match_predictions"]["Row"]> & {
          user_id: string;
          match_id: number;
          predicted_home_score: number;
          predicted_away_score: number;
        };
        Update: Partial<Database["public"]["Tables"]["match_predictions"]["Row"]>;
        Relationships: [];
      };
      points_ledger: {
        Row: {
          id: number;
          user_id: string;
          league_id: number | null;
          source_type: PointsSourceType;
          source_id: number;
          points: number;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["points_ledger"]["Row"]> & {
          user_id: string;
          source_type: PointsSourceType;
          source_id: number;
          points: number;
        };
        Update: Partial<Database["public"]["Tables"]["points_ledger"]["Row"]>;
        Relationships: [];
      };
      chat_messages: {
        Row: {
          id: number;
          user_id: string;
          content: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["chat_messages"]["Row"]> & {
          user_id: string;
          content: string;
        };
        Update: Partial<Database["public"]["Tables"]["chat_messages"]["Row"]>;
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          id: number;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["push_subscriptions"]["Row"]> & {
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
        };
        Update: Partial<Database["public"]["Tables"]["push_subscriptions"]["Row"]>;
        Relationships: [];
      };
      chat_message_reactions: {
        Row: {
          id: number;
          message_id: number;
          user_id: string;
          emoji: string;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["chat_message_reactions"]["Row"]> & {
          message_id: number;
          user_id: string;
          emoji: string;
        };
        Update: Partial<Database["public"]["Tables"]["chat_message_reactions"]["Row"]>;
        Relationships: [];
      };
      quiz_questions: {
        Row: {
          id: number;
          category: "score" | "player_career" | "trivia" | "vintage_jersey";
          difficulty: "easy" | "medium" | "hard";
          question: string;
          choices: string[];
          correct_index: number;
          explanation: string | null;
          active: boolean;
        };
        Insert: Partial<Database["public"]["Tables"]["quiz_questions"]["Row"]>;
        Update: Partial<Database["public"]["Tables"]["quiz_questions"]["Row"]>;
        Relationships: [];
      };
      quiz_answers: {
        Row: {
          id: number;
          user_id: string;
          quiz_date: string;
          position: number;
          choice_index: number;
          is_correct: boolean;
          points: number;
          created_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["quiz_answers"]["Row"]> & {
          user_id: string;
          quiz_date: string;
          position: number;
          choice_index: number;
          is_correct: boolean;
          points: number;
        };
        Update: Partial<Database["public"]["Tables"]["quiz_answers"]["Row"]>;
        Relationships: [];
      };
      quiz_results: {
        Row: {
          id: number;
          user_id: string;
          quiz_date: string;
          score: number;
          correct_count: number;
          completed_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["quiz_results"]["Row"]> & {
          user_id: string;
          quiz_date: string;
          score: number;
          correct_count: number;
        };
        Update: Partial<Database["public"]["Tables"]["quiz_results"]["Row"]>;
        Relationships: [];
      };
      reminder_log: {
        Row: {
          id: number;
          user_id: string;
          kind: "match" | "season";
          source_id: number;
          sent_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["reminder_log"]["Row"]> & {
          user_id: string;
          kind: "match" | "season";
          source_id: number;
        };
        Update: Partial<Database["public"]["Tables"]["reminder_log"]["Row"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
