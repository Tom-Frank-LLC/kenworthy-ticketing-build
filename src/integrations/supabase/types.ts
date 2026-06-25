export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      account_mappings: {
        Row: {
          account_id: string
          created_at: string
          id: string
          is_default: boolean
          notes: string | null
          source_key: string
          source_type: string
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          is_default?: boolean
          notes?: string | null
          source_key: string
          source_type: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          is_default?: boolean
          notes?: string | null
          source_key?: string
          source_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_mappings_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string
          id: string
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type: string
          id?: string
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string
          id?: string
        }
        Relationships: []
      }
      chart_of_accounts: {
        Row: {
          account_type: Database["public"]["Enums"]["coa_account_type"]
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          notes: string | null
          parent_id: string | null
          qbo_account_id: string | null
          qbo_account_name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          account_type: Database["public"]["Enums"]["coa_account_type"]
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          parent_id?: string | null
          qbo_account_id?: string | null
          qbo_account_name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          account_type?: Database["public"]["Enums"]["coa_account_type"]
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          parent_id?: string | null
          qbo_account_id?: string | null
          qbo_account_name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chart_of_accounts_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      concession_combo_items: {
        Row: {
          child_item_id: string
          combo_id: string
          created_at: string
          display_order: number
          id: string
          quantity: number
        }
        Insert: {
          child_item_id: string
          combo_id: string
          created_at?: string
          display_order?: number
          id?: string
          quantity?: number
        }
        Update: {
          child_item_id?: string
          combo_id?: string
          created_at?: string
          display_order?: number
          id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "concession_combo_items_child_item_id_fkey"
            columns: ["child_item_id"]
            isOneToOne: false
            referencedRelation: "concession_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "concession_combo_items_combo_id_fkey"
            columns: ["combo_id"]
            isOneToOne: false
            referencedRelation: "concession_items"
            referencedColumns: ["id"]
          },
        ]
      }
      concession_items: {
        Row: {
          category: string
          created_at: string
          id: string
          is_active: boolean
          is_combo: boolean
          name: string
          price: number
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_combo?: boolean
          name: string
          price?: number
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_combo?: boolean
          name?: string
          price?: number
          updated_at?: string
        }
        Relationships: []
      }
      concession_menus: {
        Row: {
          created_at: string
          file_path: string
          id: string
          is_active: boolean
          label: string
          notes: string | null
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          file_path: string
          id?: string
          is_active?: boolean
          label: string
          notes?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          file_path?: string
          id?: string
          is_active?: boolean
          label?: string
          notes?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: []
      }
      concession_sale_items: {
        Row: {
          concession_item_id: string
          id: string
          line_total: number
          quantity: number
          sale_id: string
          unit_price: number
        }
        Insert: {
          concession_item_id: string
          id?: string
          line_total: number
          quantity?: number
          sale_id: string
          unit_price: number
        }
        Update: {
          concession_item_id?: string
          id?: string
          line_total?: number
          quantity?: number
          sale_id?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "concession_sale_items_concession_item_id_fkey"
            columns: ["concession_item_id"]
            isOneToOne: false
            referencedRelation: "concession_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "concession_sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "concession_sales"
            referencedColumns: ["id"]
          },
        ]
      }
      concession_sales: {
        Row: {
          created_at: string
          id: string
          payment_method: string
          showing_id: string | null
          staff_user_id: string
          subtotal: number
          tax_amount: number
          tax_rate: number
          total: number
        }
        Insert: {
          created_at?: string
          id?: string
          payment_method?: string
          showing_id?: string | null
          staff_user_id: string
          subtotal?: number
          tax_amount?: number
          tax_rate?: number
          total?: number
        }
        Update: {
          created_at?: string
          id?: string
          payment_method?: string
          showing_id?: string | null
          staff_user_id?: string
          subtotal?: number
          tax_amount?: number
          tax_rate?: number
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "concession_sales_showing_id_fkey"
            columns: ["showing_id"]
            isOneToOne: false
            referencedRelation: "showings"
            referencedColumns: ["id"]
          },
        ]
      }
      donations: {
        Row: {
          amount_cents: number
          created_at: string
          dedicate_to: string | null
          dedication_type: string | null
          donor_email: string
          donor_name: string
          donor_phone: string | null
          id: string
          message: string | null
          notify_email: string | null
          notify_name: string | null
          square_payment_id: string | null
          square_receipt_url: string | null
          status: string
          user_id: string | null
        }
        Insert: {
          amount_cents: number
          created_at?: string
          dedicate_to?: string | null
          dedication_type?: string | null
          donor_email: string
          donor_name: string
          donor_phone?: string | null
          id?: string
          message?: string | null
          notify_email?: string | null
          notify_name?: string | null
          square_payment_id?: string | null
          square_receipt_url?: string | null
          status?: string
          user_id?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          dedicate_to?: string | null
          dedication_type?: string | null
          donor_email?: string
          donor_name?: string
          donor_phone?: string | null
          id?: string
          message?: string | null
          notify_email?: string | null
          notify_name?: string | null
          square_payment_id?: string | null
          square_receipt_url?: string | null
          status?: string
          user_id?: string | null
        }
        Relationships: []
      }
      events: {
        Row: {
          created_at: string
          description: string | null
          genre: string | null
          id: string
          is_active: boolean
          is_featured: boolean
          pass_processing_fee: boolean
          poster_url: string | null
          rating: string | null
          rsvp_url: string | null
          ticket_type: Database["public"]["Enums"]["event_ticket_type"]
          title: string
          trailer_url: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          genre?: string | null
          id?: string
          is_active?: boolean
          is_featured?: boolean
          pass_processing_fee?: boolean
          poster_url?: string | null
          rating?: string | null
          rsvp_url?: string | null
          ticket_type?: Database["public"]["Enums"]["event_ticket_type"]
          title: string
          trailer_url?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          genre?: string | null
          id?: string
          is_active?: boolean
          is_featured?: boolean
          pass_processing_fee?: boolean
          poster_url?: string | null
          rating?: string | null
          rsvp_url?: string | null
          ticket_type?: Database["public"]["Enums"]["event_ticket_type"]
          title?: string
          trailer_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      film_pass_redemptions: {
        Row: {
          amount_deducted: number
          id: string
          pass_id: string
          redeemed_at: string
          ticket_id: string
        }
        Insert: {
          amount_deducted: number
          id?: string
          pass_id: string
          redeemed_at?: string
          ticket_id: string
        }
        Update: {
          amount_deducted?: number
          id?: string
          pass_id?: string
          redeemed_at?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "film_pass_redemptions_pass_id_fkey"
            columns: ["pass_id"]
            isOneToOne: false
            referencedRelation: "user_film_passes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "film_pass_redemptions_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      film_pass_types: {
        Row: {
          created_at: string
          expiration_days: number | null
          id: string
          initial_balance: number
          is_active: boolean
          name: string
          price: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          expiration_days?: number | null
          id?: string
          initial_balance?: number
          is_active?: boolean
          name: string
          price?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          expiration_days?: number | null
          id?: string
          initial_balance?: number
          is_active?: boolean
          name?: string
          price?: number
          updated_at?: string
        }
        Relationships: []
      }
      financial_entries: {
        Row: {
          account_id: string | null
          account_source_key: string | null
          account_source_type: string | null
          adult: number | null
          attendance: number | null
          box_office: number | null
          box_tax: number | null
          check_status: string | null
          child: number | null
          con_avg: number | null
          concession_tax: number | null
          concessions: number | null
          created_at: string
          distributor: string | null
          entry_date: string | null
          event_name: string | null
          fee_terms: string | null
          format: string | null
          free: number | null
          id: string
          is_month_total: boolean
          kfs: number | null
          licensing: number | null
          matched_movie_id: string | null
          matched_showing_id: string | null
          merch: number | null
          needs_account_review: boolean
          net: number | null
          net_plus_pass: number | null
          notes: string | null
          online_mkt: number | null
          other_fees: number | null
          pass_amount: number | null
          passes: number | null
          print_mkt: number | null
          raw_row: Json | null
          rental: number | null
          sales_tax: number | null
          series: string | null
          shipping: number | null
          source_month: string | null
          source_year: number
          sponsorship: number | null
          square_fee: number | null
          staff: number | null
          supply: number | null
          total_expense: number | null
          total_income: number | null
          updated_at: string
          utilities: number | null
          weekday: string | null
        }
        Insert: {
          account_id?: string | null
          account_source_key?: string | null
          account_source_type?: string | null
          adult?: number | null
          attendance?: number | null
          box_office?: number | null
          box_tax?: number | null
          check_status?: string | null
          child?: number | null
          con_avg?: number | null
          concession_tax?: number | null
          concessions?: number | null
          created_at?: string
          distributor?: string | null
          entry_date?: string | null
          event_name?: string | null
          fee_terms?: string | null
          format?: string | null
          free?: number | null
          id?: string
          is_month_total?: boolean
          kfs?: number | null
          licensing?: number | null
          matched_movie_id?: string | null
          matched_showing_id?: string | null
          merch?: number | null
          needs_account_review?: boolean
          net?: number | null
          net_plus_pass?: number | null
          notes?: string | null
          online_mkt?: number | null
          other_fees?: number | null
          pass_amount?: number | null
          passes?: number | null
          print_mkt?: number | null
          raw_row?: Json | null
          rental?: number | null
          sales_tax?: number | null
          series?: string | null
          shipping?: number | null
          source_month?: string | null
          source_year: number
          sponsorship?: number | null
          square_fee?: number | null
          staff?: number | null
          supply?: number | null
          total_expense?: number | null
          total_income?: number | null
          updated_at?: string
          utilities?: number | null
          weekday?: string | null
        }
        Update: {
          account_id?: string | null
          account_source_key?: string | null
          account_source_type?: string | null
          adult?: number | null
          attendance?: number | null
          box_office?: number | null
          box_tax?: number | null
          check_status?: string | null
          child?: number | null
          con_avg?: number | null
          concession_tax?: number | null
          concessions?: number | null
          created_at?: string
          distributor?: string | null
          entry_date?: string | null
          event_name?: string | null
          fee_terms?: string | null
          format?: string | null
          free?: number | null
          id?: string
          is_month_total?: boolean
          kfs?: number | null
          licensing?: number | null
          matched_movie_id?: string | null
          matched_showing_id?: string | null
          merch?: number | null
          needs_account_review?: boolean
          net?: number | null
          net_plus_pass?: number | null
          notes?: string | null
          online_mkt?: number | null
          other_fees?: number | null
          pass_amount?: number | null
          passes?: number | null
          print_mkt?: number | null
          raw_row?: Json | null
          rental?: number | null
          sales_tax?: number | null
          series?: string | null
          shipping?: number | null
          source_month?: string | null
          source_year?: number
          sponsorship?: number | null
          square_fee?: number | null
          staff?: number | null
          supply?: number | null
          total_expense?: number | null
          total_income?: number | null
          updated_at?: string
          utilities?: number | null
          weekday?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "financial_entries_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_entries_matched_movie_id_fkey"
            columns: ["matched_movie_id"]
            isOneToOne: false
            referencedRelation: "movies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_entries_matched_showing_id_fkey"
            columns: ["matched_showing_id"]
            isOneToOne: false
            referencedRelation: "showings"
            referencedColumns: ["id"]
          },
        ]
      }
      historical_screenings: {
        Row: {
          created_at: string
          film_title_display: string
          film_title_normalized: string
          film_year: number | null
          id: string
          is_double_feature: boolean
          match_confidence: string | null
          matched_movie_id: string | null
          raw_cell: string
          screening_date: string
          updated_at: string
          venue_name: string
          year: number
        }
        Insert: {
          created_at?: string
          film_title_display: string
          film_title_normalized: string
          film_year?: number | null
          id?: string
          is_double_feature?: boolean
          match_confidence?: string | null
          matched_movie_id?: string | null
          raw_cell: string
          screening_date: string
          updated_at?: string
          venue_name: string
          year: number
        }
        Update: {
          created_at?: string
          film_title_display?: string
          film_title_normalized?: string
          film_year?: number | null
          id?: string
          is_double_feature?: boolean
          match_confidence?: string | null
          matched_movie_id?: string | null
          raw_cell?: string
          screening_date?: string
          updated_at?: string
          venue_name?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "historical_screenings_matched_movie_id_fkey"
            columns: ["matched_movie_id"]
            isOneToOne: false
            referencedRelation: "movies"
            referencedColumns: ["id"]
          },
        ]
      }
      host_event_assignments: {
        Row: {
          created_at: string
          event_id: string | null
          id: string
          live_performance_id: string | null
          movie_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id?: string | null
          id?: string
          live_performance_id?: string | null
          movie_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string | null
          id?: string
          live_performance_id?: string | null
          movie_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "host_event_assignments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "host_event_assignments_live_performance_id_fkey"
            columns: ["live_performance_id"]
            isOneToOne: false
            referencedRelation: "live_performances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "host_event_assignments_movie_id_fkey"
            columns: ["movie_id"]
            isOneToOne: false
            referencedRelation: "movies"
            referencedColumns: ["id"]
          },
        ]
      }
      kenworthy_history: {
        Row: {
          category: string
          created_at: string
          description: string | null
          display_order: number
          end_date: string | null
          event_date: string | null
          id: string
          image_url: string | null
          source_url: string | null
          title: string
          updated_at: string
          year: number
        }
        Insert: {
          category: string
          created_at?: string
          description?: string | null
          display_order?: number
          end_date?: string | null
          event_date?: string | null
          id?: string
          image_url?: string | null
          source_url?: string | null
          title: string
          updated_at?: string
          year: number
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          display_order?: number
          end_date?: string | null
          event_date?: string | null
          id?: string
          image_url?: string | null
          source_url?: string | null
          title?: string
          updated_at?: string
          year?: number
        }
        Relationships: []
      }
      labor_settings: {
        Row: {
          created_at: string
          id: string
          ot_weekly_hours: number
          role_wage_defaults: Json
          tip_method: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          ot_weekly_hours?: number
          role_wage_defaults?: Json
          tip_method?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          ot_weekly_hours?: number
          role_wage_defaults?: Json
          tip_method?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      live_performances: {
        Row: {
          created_at: string
          description: string | null
          genre: string | null
          id: string
          is_active: boolean
          is_featured: boolean
          pass_processing_fee: boolean
          poster_url: string | null
          rating: string | null
          subcategory: Database["public"]["Enums"]["live_performance_subcategory"]
          title: string
          trailer_url: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          genre?: string | null
          id?: string
          is_active?: boolean
          is_featured?: boolean
          pass_processing_fee?: boolean
          poster_url?: string | null
          rating?: string | null
          subcategory?: Database["public"]["Enums"]["live_performance_subcategory"]
          title: string
          trailer_url?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          genre?: string | null
          id?: string
          is_active?: boolean
          is_featured?: boolean
          pass_processing_fee?: boolean
          poster_url?: string | null
          rating?: string | null
          subcategory?: Database["public"]["Enums"]["live_performance_subcategory"]
          title?: string
          trailer_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      movies: {
        Row: {
          circuit: string | null
          created_at: string
          description: string | null
          distributor: string | null
          duration_minutes: number
          genre: string | null
          id: string
          is_active: boolean
          is_featured: boolean
          pass_processing_fee: boolean
          poster_url: string | null
          rating: string | null
          release_label: string | null
          release_year: number | null
          terms_percent: number | null
          title: string
          trailer_url: string | null
          updated_at: string
        }
        Insert: {
          circuit?: string | null
          created_at?: string
          description?: string | null
          distributor?: string | null
          duration_minutes?: number
          genre?: string | null
          id?: string
          is_active?: boolean
          is_featured?: boolean
          pass_processing_fee?: boolean
          poster_url?: string | null
          rating?: string | null
          release_label?: string | null
          release_year?: number | null
          terms_percent?: number | null
          title: string
          trailer_url?: string | null
          updated_at?: string
        }
        Update: {
          circuit?: string | null
          created_at?: string
          description?: string | null
          distributor?: string | null
          duration_minutes?: number
          genre?: string | null
          id?: string
          is_active?: boolean
          is_featured?: boolean
          pass_processing_fee?: boolean
          poster_url?: string | null
          rating?: string | null
          release_label?: string | null
          release_year?: number | null
          terms_percent?: number | null
          title?: string
          trailer_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      payroll_exports: {
        Row: {
          created_at: string
          error_message: string | null
          exported_by: string | null
          id: string
          period_end: string
          period_start: string
          qbo_batch_id: string | null
          status: string
          totals: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          exported_by?: string | null
          id?: string
          period_end: string
          period_start: string
          qbo_batch_id?: string | null
          status?: string
          totals?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          exported_by?: string | null
          id?: string
          period_end?: string
          period_start?: string
          qbo_batch_id?: string | null
          status?: string
          totals?: Json
          updated_at?: string
        }
        Relationships: []
      }
      production_price_tiers: {
        Row: {
          color: string
          created_at: string
          display_order: number
          id: string
          price: number
          production_id: string
          production_type: string
          tier_name: string
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          display_order?: number
          id?: string
          price: number
          production_id: string
          production_type: string
          tier_name: string
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          display_order?: number
          id?: string
          price?: number
          production_id?: string
          production_type?: string
          tier_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      production_seat_tiers: {
        Row: {
          created_at: string
          id: string
          production_id: string
          production_type: string
          tier_template_id: string
          venue_seat_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          production_id: string
          production_type: string
          tier_template_id: string
          venue_seat_id: string
        }
        Update: {
          created_at?: string
          id?: string
          production_id?: string
          production_type?: string
          tier_template_id?: string
          venue_seat_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_seat_tiers_tier_template_id_fkey"
            columns: ["tier_template_id"]
            isOneToOne: false
            referencedRelation: "production_price_tiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_seat_tiers_venue_seat_id_fkey"
            columns: ["venue_seat_id"]
            isOneToOne: false
            referencedRelation: "venue_seats"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          phone: string | null
          signer_title: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          phone?: string | null
          signer_title?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          phone?: string | null
          signer_title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      qbo_connection: {
        Row: {
          access_token_secret_id: string | null
          connected_at: string | null
          connected_by: string | null
          created_at: string
          environment: string
          id: string
          is_active: boolean
          realm_id: string | null
          refresh_token_secret_id: string | null
          token_expires_at: string | null
          updated_at: string
        }
        Insert: {
          access_token_secret_id?: string | null
          connected_at?: string | null
          connected_by?: string | null
          created_at?: string
          environment?: string
          id?: string
          is_active?: boolean
          realm_id?: string | null
          refresh_token_secret_id?: string | null
          token_expires_at?: string | null
          updated_at?: string
        }
        Update: {
          access_token_secret_id?: string | null
          connected_at?: string | null
          connected_by?: string | null
          created_at?: string
          environment?: string
          id?: string
          is_active?: boolean
          realm_id?: string | null
          refresh_token_secret_id?: string | null
          token_expires_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      qbo_sync_jobs: {
        Row: {
          account_id: string | null
          attempts: number
          created_at: string
          entry_id: string
          entry_table: string
          error_message: string | null
          id: string
          qbo_txn_id: string | null
          status: string
          synced_at: string | null
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          attempts?: number
          created_at?: string
          entry_id: string
          entry_table: string
          error_message?: string | null
          id?: string
          qbo_txn_id?: string | null
          status?: string
          synced_at?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          attempts?: number
          created_at?: string
          entry_id?: string
          entry_table?: string
          error_message?: string | null
          id?: string
          qbo_txn_id?: string | null
          status?: string
          synced_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qbo_sync_jobs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_invoice_lines: {
        Row: {
          account_id: string | null
          created_at: string
          description: string
          id: string
          is_taxable: boolean
          line_kind: string
          quantity: number
          rental_request_id: string
          sort_order: number
          unit_price: number
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          description: string
          id?: string
          is_taxable?: boolean
          line_kind?: string
          quantity?: number
          rental_request_id: string
          sort_order?: number
          unit_price?: number
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          created_at?: string
          description?: string
          id?: string
          is_taxable?: boolean
          line_kind?: string
          quantity?: number
          rental_request_id?: string
          sort_order?: number
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_invoice_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_invoice_lines_rental_request_id_fkey"
            columns: ["rental_request_id"]
            isOneToOne: false
            referencedRelation: "rental_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_requests: {
        Row: {
          accessibility_requirements: string | null
          activity_order: string | null
          admin_notes: string | null
          age_range: string | null
          applicant_name: string
          arrival_time: string | null
          contract_data: Json
          contract_status: string
          created_at: string
          departure_time: string | null
          email: string
          equipment: Json | null
          event_description: string | null
          event_end_time: string | null
          event_start_time: string | null
          event_title: string
          expected_guests: number | null
          id: string
          invite_token: string | null
          is_public: boolean | null
          is_ticketed: boolean | null
          kenworthy_provides_media: boolean | null
          linked_event_id: string | null
          marquee_text: string | null
          media_notes: string | null
          needs_digital_ticketing: boolean | null
          organization_name: string | null
          phone: string | null
          proposed_date: string | null
          renter_provides_media: boolean | null
          secondary_contact_email: string | null
          secondary_contact_name: string | null
          secondary_contact_phone: string | null
          signature_serial: string | null
          signed_at: string | null
          signed_by: string | null
          signed_by_name: string | null
          signed_by_title: string | null
          signed_pdf_sha256: string | null
          special_needs: string | null
          status: Database["public"]["Enums"]["rental_request_status"]
          submitted_at: string
          updated_at: string
          venue_area: string | null
          wants_beer_wine: boolean | null
          wants_concessions: boolean | null
        }
        Insert: {
          accessibility_requirements?: string | null
          activity_order?: string | null
          admin_notes?: string | null
          age_range?: string | null
          applicant_name: string
          arrival_time?: string | null
          contract_data?: Json
          contract_status?: string
          created_at?: string
          departure_time?: string | null
          email: string
          equipment?: Json | null
          event_description?: string | null
          event_end_time?: string | null
          event_start_time?: string | null
          event_title: string
          expected_guests?: number | null
          id?: string
          invite_token?: string | null
          is_public?: boolean | null
          is_ticketed?: boolean | null
          kenworthy_provides_media?: boolean | null
          linked_event_id?: string | null
          marquee_text?: string | null
          media_notes?: string | null
          needs_digital_ticketing?: boolean | null
          organization_name?: string | null
          phone?: string | null
          proposed_date?: string | null
          renter_provides_media?: boolean | null
          secondary_contact_email?: string | null
          secondary_contact_name?: string | null
          secondary_contact_phone?: string | null
          signature_serial?: string | null
          signed_at?: string | null
          signed_by?: string | null
          signed_by_name?: string | null
          signed_by_title?: string | null
          signed_pdf_sha256?: string | null
          special_needs?: string | null
          status?: Database["public"]["Enums"]["rental_request_status"]
          submitted_at?: string
          updated_at?: string
          venue_area?: string | null
          wants_beer_wine?: boolean | null
          wants_concessions?: boolean | null
        }
        Update: {
          accessibility_requirements?: string | null
          activity_order?: string | null
          admin_notes?: string | null
          age_range?: string | null
          applicant_name?: string
          arrival_time?: string | null
          contract_data?: Json
          contract_status?: string
          created_at?: string
          departure_time?: string | null
          email?: string
          equipment?: Json | null
          event_description?: string | null
          event_end_time?: string | null
          event_start_time?: string | null
          event_title?: string
          expected_guests?: number | null
          id?: string
          invite_token?: string | null
          is_public?: boolean | null
          is_ticketed?: boolean | null
          kenworthy_provides_media?: boolean | null
          linked_event_id?: string | null
          marquee_text?: string | null
          media_notes?: string | null
          needs_digital_ticketing?: boolean | null
          organization_name?: string | null
          phone?: string | null
          proposed_date?: string | null
          renter_provides_media?: boolean | null
          secondary_contact_email?: string | null
          secondary_contact_name?: string | null
          secondary_contact_phone?: string | null
          signature_serial?: string | null
          signed_at?: string | null
          signed_by?: string | null
          signed_by_name?: string | null
          signed_by_title?: string | null
          signed_pdf_sha256?: string | null
          special_needs?: string | null
          status?: Database["public"]["Enums"]["rental_request_status"]
          submitted_at?: string
          updated_at?: string
          venue_area?: string | null
          wants_beer_wine?: boolean | null
          wants_concessions?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "rental_requests_linked_event_id_fkey"
            columns: ["linked_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      seats: {
        Row: {
          id: string
          seat_number: number
          seat_row: string
          seat_type: string
          section: string
        }
        Insert: {
          id?: string
          seat_number: number
          seat_row: string
          seat_type?: string
          section?: string
        }
        Update: {
          id?: string
          seat_number?: number
          seat_row?: string
          seat_type?: string
          section?: string
        }
        Relationships: []
      }
      shift_requests: {
        Row: {
          created_at: string
          id: string
          note: string | null
          request_type: string
          requester_id: string
          resolved_at: string | null
          resolved_by: string | null
          shift_end: string | null
          shift_id: string | null
          shift_start: string | null
          status: string
          target_user_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          request_type: string
          requester_id: string
          resolved_at?: string | null
          resolved_by?: string | null
          shift_end?: string | null
          shift_id?: string | null
          shift_start?: string | null
          status?: string
          target_user_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          request_type?: string
          requester_id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          shift_end?: string | null
          shift_id?: string | null
          shift_start?: string | null
          status?: string
          target_user_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      showing_price_tiers: {
        Row: {
          color: string
          created_at: string
          display_order: number
          id: string
          is_active: boolean
          price: number
          showing_id: string
          tier_name: string
        }
        Insert: {
          color?: string
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          price?: number
          showing_id: string
          tier_name?: string
        }
        Update: {
          color?: string
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          price?: number
          showing_id?: string
          tier_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "showing_price_tiers_showing_id_fkey"
            columns: ["showing_id"]
            isOneToOne: false
            referencedRelation: "showings"
            referencedColumns: ["id"]
          },
        ]
      }
      showing_seat_tiers: {
        Row: {
          created_at: string
          id: string
          showing_id: string
          tier_id: string
          venue_seat_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          showing_id: string
          tier_id: string
          venue_seat_id: string
        }
        Update: {
          created_at?: string
          id?: string
          showing_id?: string
          tier_id?: string
          venue_seat_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "showing_seat_tiers_showing_id_fkey"
            columns: ["showing_id"]
            isOneToOne: false
            referencedRelation: "showings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "showing_seat_tiers_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "showing_price_tiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "showing_seat_tiers_venue_seat_id_fkey"
            columns: ["venue_seat_id"]
            isOneToOne: false
            referencedRelation: "venue_seats"
            referencedColumns: ["id"]
          },
        ]
      }
      showings: {
        Row: {
          created_at: string
          event_id: string | null
          id: string
          is_active: boolean
          live_performance_id: string | null
          movie_id: string | null
          requires_seat_selection: boolean
          start_time: string
          ticket_price: number
          total_seats: number
          updated_at: string
          venue_id: string | null
        }
        Insert: {
          created_at?: string
          event_id?: string | null
          id?: string
          is_active?: boolean
          live_performance_id?: string | null
          movie_id?: string | null
          requires_seat_selection?: boolean
          start_time: string
          ticket_price?: number
          total_seats?: number
          updated_at?: string
          venue_id?: string | null
        }
        Update: {
          created_at?: string
          event_id?: string | null
          id?: string
          is_active?: boolean
          live_performance_id?: string | null
          movie_id?: string | null
          requires_seat_selection?: boolean
          start_time?: string
          ticket_price?: number
          total_seats?: number
          updated_at?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "showings_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "showings_live_performance_id_fkey"
            columns: ["live_performance_id"]
            isOneToOne: false
            referencedRelation: "live_performances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "showings_movie_id_fkey"
            columns: ["movie_id"]
            isOneToOne: false
            referencedRelation: "movies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "showings_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      signing_keys: {
        Row: {
          active: boolean
          algorithm: string
          created_at: string
          id: string
          private_key_b64: string
          public_key_b64: string
        }
        Insert: {
          active?: boolean
          algorithm?: string
          created_at?: string
          id?: string
          private_key_b64: string
          public_key_b64: string
        }
        Update: {
          active?: boolean
          algorithm?: string
          created_at?: string
          id?: string
          private_key_b64?: string
          public_key_b64?: string
        }
        Relationships: []
      }
      sponsorship_opportunities: {
        Row: {
          availability_text: string | null
          benefits: Json
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          contact_title: string | null
          created_at: string
          created_by: string | null
          cta_label: string | null
          display_order: number
          hero_image_url: string | null
          hook_text: string | null
          id: string
          intro_text: string | null
          is_active: boolean
          price_text: string | null
          section_body: string | null
          section_heading: string | null
          slug: string
          stats_text: string | null
          tagline: string | null
          title: string
          updated_at: string
        }
        Insert: {
          availability_text?: string | null
          benefits?: Json
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          contact_title?: string | null
          created_at?: string
          created_by?: string | null
          cta_label?: string | null
          display_order?: number
          hero_image_url?: string | null
          hook_text?: string | null
          id?: string
          intro_text?: string | null
          is_active?: boolean
          price_text?: string | null
          section_body?: string | null
          section_heading?: string | null
          slug: string
          stats_text?: string | null
          tagline?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          availability_text?: string | null
          benefits?: Json
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          contact_title?: string | null
          created_at?: string
          created_by?: string | null
          cta_label?: string | null
          display_order?: number
          hero_image_url?: string | null
          hook_text?: string | null
          id?: string
          intro_text?: string | null
          is_active?: boolean
          price_text?: string | null
          section_body?: string | null
          section_heading?: string | null
          slug?: string
          stats_text?: string | null
          tagline?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      staff_square_links: {
        Row: {
          created_at: string
          id: string
          square_team_member_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          square_team_member_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          square_team_member_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tickets: {
        Row: {
          comp_recipient_email: string | null
          comp_recipient_name: string | null
          id: string
          issued_by_user_id: string | null
          payment_method: string
          price: number
          processing_fee: number
          purchased_at: string
          qr_code: string | null
          scanned_at: string | null
          seat_id: string | null
          showing_id: string
          status: string
          tax_amount: number
          tax_rate: number
          tier_id: string | null
          total_price: number
          user_id: string
        }
        Insert: {
          comp_recipient_email?: string | null
          comp_recipient_name?: string | null
          id?: string
          issued_by_user_id?: string | null
          payment_method?: string
          price: number
          processing_fee?: number
          purchased_at?: string
          qr_code?: string | null
          scanned_at?: string | null
          seat_id?: string | null
          showing_id: string
          status?: string
          tax_amount: number
          tax_rate?: number
          tier_id?: string | null
          total_price: number
          user_id: string
        }
        Update: {
          comp_recipient_email?: string | null
          comp_recipient_name?: string | null
          id?: string
          issued_by_user_id?: string | null
          payment_method?: string
          price?: number
          processing_fee?: number
          purchased_at?: string
          qr_code?: string | null
          scanned_at?: string | null
          seat_id?: string | null
          showing_id?: string
          status?: string
          tax_amount?: number
          tax_rate?: number
          tier_id?: string | null
          total_price?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tickets_seat_id_fkey"
            columns: ["seat_id"]
            isOneToOne: false
            referencedRelation: "seats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_showing_id_fkey"
            columns: ["showing_id"]
            isOneToOne: false
            referencedRelation: "showings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "showing_price_tiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_film_passes: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          pass_type_id: string
          payment_method: string
          purchased_at: string
          remaining_balance: number
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          pass_type_id: string
          payment_method?: string
          purchased_at?: string
          remaining_balance: number
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          pass_type_id?: string
          payment_method?: string
          purchased_at?: string
          remaining_balance?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_film_passes_pass_type_id_fkey"
            columns: ["pass_type_id"]
            isOneToOne: false
            referencedRelation: "film_pass_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_film_passes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      venue_seats: {
        Row: {
          id: string
          seat_number: number
          seat_row: string
          seat_type: string
          section: string
          venue_id: string
        }
        Insert: {
          id?: string
          seat_number: number
          seat_row: string
          seat_type?: string
          section?: string
          venue_id: string
        }
        Update: {
          id?: string
          seat_number?: number
          seat_row?: string
          seat_type?: string
          section?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_seats_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venues: {
        Row: {
          created_at: string
          description: string | null
          has_assigned_seating: boolean
          id: string
          is_active: boolean
          name: string
          total_seats: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          has_assigned_seating?: boolean
          id?: string
          is_active?: boolean
          name: string
          total_seats?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          has_assigned_seating?: boolean
          id?: string
          is_active?: boolean
          name?: string
          total_seats?: number
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_production_template_to_showing: {
        Args: { p_showing_id: string }
        Returns: undefined
      }
      get_contract_signature: {
        Args: { p_request_id: string }
        Returns: {
          algorithm: string
          applicant_name: string
          event_title: string
          public_key_b64: string
          signature_b64: string
          signed_at: string
          signed_by_name: string
          signed_by_title: string
          signed_pdf_sha256: string
        }[]
      }
      get_rental_request_by_token: {
        Args: { p_token: string }
        Returns: {
          accessibility_requirements: string | null
          activity_order: string | null
          admin_notes: string | null
          age_range: string | null
          applicant_name: string
          arrival_time: string | null
          contract_data: Json
          contract_status: string
          created_at: string
          departure_time: string | null
          email: string
          equipment: Json | null
          event_description: string | null
          event_end_time: string | null
          event_start_time: string | null
          event_title: string
          expected_guests: number | null
          id: string
          invite_token: string | null
          is_public: boolean | null
          is_ticketed: boolean | null
          kenworthy_provides_media: boolean | null
          linked_event_id: string | null
          marquee_text: string | null
          media_notes: string | null
          needs_digital_ticketing: boolean | null
          organization_name: string | null
          phone: string | null
          proposed_date: string | null
          renter_provides_media: boolean | null
          secondary_contact_email: string | null
          secondary_contact_name: string | null
          secondary_contact_phone: string | null
          signature_serial: string | null
          signed_at: string | null
          signed_by: string | null
          signed_by_name: string | null
          signed_by_title: string | null
          signed_pdf_sha256: string | null
          special_needs: string | null
          status: Database["public"]["Enums"]["rental_request_status"]
          submitted_at: string
          updated_at: string
          venue_area: string | null
          wants_beer_wine: boolean | null
          wants_concessions: boolean | null
        }[]
        SetofOptions: {
          from: "*"
          to: "rental_requests"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_host_of: {
        Args: {
          _event_id: string
          _live_performance_id: string
          _movie_id: string
          _user_id: string
        }
        Returns: boolean
      }
      is_host_of_showing: {
        Args: { _showing_id: string; _user_id: string }
        Returns: boolean
      }
      qbo_disconnect: { Args: { p_environment?: string }; Returns: boolean }
      qbo_get_active_tokens: {
        Args: { p_environment?: string }
        Returns: {
          access_token: string
          connection_id: string
          realm_id: string
          refresh_token: string
          token_expires_at: string
        }[]
      }
      qbo_save_tokens: {
        Args: {
          p_access_token: string
          p_environment?: string
          p_expires_at: string
          p_realm_id: string
          p_refresh_token: string
        }
        Returns: string
      }
      redeem_film_pass: {
        Args: { p_amount: number; p_pass_id: string; p_ticket_id: string }
        Returns: boolean
      }
      resolve_account_id: {
        Args: { p_source_key: string; p_source_type: string }
        Returns: string
      }
    }
    Enums: {
      app_role: "admin" | "regular_user" | "staff" | "host"
      coa_account_type:
        | "income"
        | "contra_income"
        | "expense"
        | "contra_expense"
        | "other_income"
        | "other_expense"
      event_ticket_type: "ticketed" | "rsvp" | "info_only"
      live_performance_subcategory:
        | "concert"
        | "stand_up_comedy"
        | "theatre"
        | "dance"
      rental_request_status:
        | "pending"
        | "reviewing"
        | "approved"
        | "declined"
        | "archived"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "regular_user", "staff", "host"],
      coa_account_type: [
        "income",
        "contra_income",
        "expense",
        "contra_expense",
        "other_income",
        "other_expense",
      ],
      event_ticket_type: ["ticketed", "rsvp", "info_only"],
      live_performance_subcategory: [
        "concert",
        "stand_up_comedy",
        "theatre",
        "dance",
      ],
      rental_request_status: [
        "pending",
        "reviewing",
        "approved",
        "declined",
        "archived",
      ],
    },
  },
} as const
