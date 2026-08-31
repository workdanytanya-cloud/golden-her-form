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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_notifications: {
        Row: {
          client_id: string
          created_at: string
          id: string
          is_read: boolean
          measurement_id: string | null
          message: string
          type: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          is_read?: boolean
          measurement_id?: string | null
          message: string
          type?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          is_read?: boolean
          measurement_id?: string | null
          message?: string
          type?: string
        }
        Relationships: []
      }
      leads: {
        Row: {
          id: string
          created_at: string
          updated_at: string
          full_name: string
          age: number
          phone: string
          email: string
          messenger: string
          source: string
          program_slug: string | null
          program_title: string | null
          message: string | null
          status: string
          notes: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          updated_at?: string
          full_name: string
          age: number
          phone: string
          email: string
          messenger?: string
          source?: string
          program_slug?: string | null
          program_title?: string | null
          message?: string | null
          status?: string
          notes?: string | null
        }
        Update: {
          id?: string
          created_at?: string
          updated_at?: string
          full_name?: string
          age?: number
          phone?: string
          email?: string
          messenger?: string
          source?: string
          program_slug?: string | null
          program_title?: string | null
          message?: string | null
          status?: string
          notes?: string | null
        }
        Relationships: []
      }
      promo_codes: {
        Row: {
          id: string
          created_at: string
          code: string
          label: string | null
          program_slug: string | null
          program_title: string | null
          status: string
          created_by: string | null
          used_by: string | null
          used_at: string | null
          expires_at: string | null
          notes: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          code: string
          label?: string | null
          program_slug?: string | null
          program_title?: string | null
          status?: string
          created_by?: string | null
          used_by?: string | null
          used_at?: string | null
          expires_at?: string | null
          notes?: string | null
        }
        Update: {
          id?: string
          created_at?: string
          code?: string
          label?: string | null
          program_slug?: string | null
          program_title?: string | null
          status?: string
          created_by?: string | null
          used_by?: string | null
          used_at?: string | null
          expires_at?: string | null
          notes?: string | null
        }
        Relationships: []
      }
      client_courses: {
        Row: {
          id: string
          client_id: string
          title: string
          start_date: string
          end_date: string
          status: string
          created_at: string
          created_by: string | null
          notes: string | null
        }
        Insert: {
          id?: string
          client_id: string
          title: string
          start_date: string
          end_date: string
          status?: string
          created_at?: string
          created_by?: string | null
          notes?: string | null
        }
        Update: {
          id?: string
          client_id?: string
          title?: string
          start_date?: string
          end_date?: string
          status?: string
          created_at?: string
          created_by?: string | null
          notes?: string | null
        }
        Relationships: []
      }
      client_access: {
        Row: {
          activated_at: string | null
          activated_by: string | null
          created_at: string
          notes: string | null
          status: string
          unlock_source: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          activated_at?: string | null
          activated_by?: string | null
          created_at?: string
          notes?: string | null
          status?: string
          unlock_source?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          activated_at?: string | null
          activated_by?: string | null
          created_at?: string
          notes?: string | null
          status?: string
          unlock_source?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      client_notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          link: string | null
          message: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          message: string
          type: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          message?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      dishes: {
        Row: {
          calories_per_100g: number
          carbs_per_100g: number
          created_at: string
          description: string | null
          fat_per_100g: number
          id: string
          image_url: string | null
          ingredients: Json
          meal_type: string
          name: string
          portion_weight_g: number
          protein_per_100g: number
          replacements: string[]
          slug: string
          steps: Json
          tags: string[]
          updated_at: string
          video_url: string | null
        }
        Insert: {
          calories_per_100g: number
          carbs_per_100g: number
          created_at?: string
          description?: string | null
          fat_per_100g: number
          id?: string
          image_url?: string | null
          ingredients?: Json
          meal_type: string
          name: string
          portion_weight_g: number
          protein_per_100g: number
          replacements?: string[]
          slug: string
          steps?: Json
          tags?: string[]
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          calories_per_100g?: number
          carbs_per_100g?: number
          created_at?: string
          description?: string | null
          fat_per_100g?: number
          id?: string
          image_url?: string | null
          ingredients?: Json
          meal_type?: string
          name?: string
          portion_weight_g?: number
          protein_per_100g?: number
          replacements?: string[]
          slug?: string
          steps?: Json
          tags?: string[]
          updated_at?: string
          video_url?: string | null
        }
        Relationships: []
      }
      food_products: {
        Row: {
          id: string
          slug: string
          name: string
          category: string
          brand: string | null
          state: string
          measurement_basis: string
          kcal_per_100g: number
          protein_per_100g: number
          fat_per_100g: number
          carbs_per_100g: number
          fiber_per_100g: number | null
          density: number | null
          source_name: string
          source_url: string | null
          verified_at: string | null
          is_verified: boolean
          is_active: boolean
          allowed_for_snack: boolean
          requires_cooking: boolean
          weighing_note: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          slug: string
          name: string
          category: string
          brand?: string | null
          state: string
          measurement_basis: string
          kcal_per_100g: number
          protein_per_100g: number
          fat_per_100g: number
          carbs_per_100g: number
          fiber_per_100g?: number | null
          density?: number | null
          source_name: string
          source_url?: string | null
          verified_at?: string | null
          is_verified?: boolean
          is_active?: boolean
          allowed_for_snack?: boolean
          requires_cooking?: boolean
          weighing_note?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          slug?: string
          name?: string
          category?: string
          brand?: string | null
          state?: string
          measurement_basis?: string
          kcal_per_100g?: number
          protein_per_100g?: number
          fat_per_100g?: number
          carbs_per_100g?: number
          fiber_per_100g?: number | null
          density?: number | null
          source_name?: string
          source_url?: string | null
          verified_at?: string | null
          is_verified?: boolean
          is_active?: boolean
          allowed_for_snack?: boolean
          requires_cooking?: boolean
          weighing_note?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      meal_plan_item_ingredients: {
        Row: {
          id: string
          meal_item_id: string
          product_id: string | null
          product_name: string
          grams: number
          weighing_note: string | null
          kcal_per_100g: number
          protein_per_100g: number
          fat_per_100g: number
          carbs_per_100g: number
          fiber_per_100g: number | null
          kcal: number
          protein_g: number
          fat_g: number
          carbs_g: number
          fiber_g: number
          sort_order: number
        }
        Insert: {
          id?: string
          meal_item_id: string
          product_id?: string | null
          product_name: string
          grams: number
          weighing_note?: string | null
          kcal_per_100g: number
          protein_per_100g: number
          fat_per_100g: number
          carbs_per_100g: number
          fiber_per_100g?: number | null
          kcal: number
          protein_g: number
          fat_g: number
          carbs_g: number
          fiber_g?: number
          sort_order?: number
        }
        Update: {
          id?: string
          meal_item_id?: string
          product_id?: string | null
          product_name?: string
          grams?: number
          weighing_note?: string | null
          kcal_per_100g?: number
          protein_per_100g?: number
          fat_per_100g?: number
          carbs_per_100g?: number
          fiber_per_100g?: number | null
          kcal?: number
          protein_g?: number
          fat_g?: number
          carbs_g?: number
          fiber_g?: number
          sort_order?: number
        }
        Relationships: []
      }
      meal_plan_items: {
        Row: {
          id: string
          plan_day_id: string
          slot: string
          recipe_id: string | null
          recipe_name: string
          requires_cooking: boolean
          prep_time_min: number | null
          steps: Json
          weighing_note: string | null
          snack_action: string | null
          kcal: number
          protein_g: number
          fat_g: number
          carbs_g: number
          fiber_g: number
          is_valid: boolean
          sort_order: number
          created_at: string
        }
        Insert: {
          id?: string
          plan_day_id: string
          slot: string
          recipe_id?: string | null
          recipe_name: string
          requires_cooking?: boolean
          prep_time_min?: number | null
          steps?: Json
          weighing_note?: string | null
          snack_action?: string | null
          kcal: number
          protein_g: number
          fat_g: number
          carbs_g: number
          fiber_g?: number
          is_valid?: boolean
          sort_order?: number
          created_at?: string
        }
        Update: {
          id?: string
          plan_day_id?: string
          slot?: string
          recipe_id?: string | null
          recipe_name?: string
          requires_cooking?: boolean
          prep_time_min?: number | null
          steps?: Json
          weighing_note?: string | null
          snack_action?: string | null
          kcal?: number
          protein_g?: number
          fat_g?: number
          carbs_g?: number
          fiber_g?: number
          is_valid?: boolean
          sort_order?: number
          created_at?: string
        }
        Relationships: []
      }
      recipe_ingredients: {
        Row: {
          id: string
          recipe_id: string
          product_id: string
          min_g: number
          max_g: number
          default_g: number | null
          is_scalable: boolean
          sort_order: number
          optional: boolean
        }
        Insert: {
          id?: string
          recipe_id: string
          product_id: string
          min_g: number
          max_g: number
          default_g?: number | null
          is_scalable?: boolean
          sort_order?: number
          optional?: boolean
        }
        Update: {
          id?: string
          recipe_id?: string
          product_id?: string
          min_g?: number
          max_g?: number
          default_g?: number | null
          is_scalable?: boolean
          sort_order?: number
          optional?: boolean
        }
        Relationships: []
      }
      recipes: {
        Row: {
          id: string
          slug: string
          name: string
          meal_type: string
          steps: Json
          prep_time_min: number | null
          requires_cooking: boolean
          is_active: boolean
          weighing_note: string | null
          is_nutrient_dense: boolean
          contains_protein_source: boolean
          contains_fruit_or_vegetable: boolean
          is_treat: boolean
          allowed_schedule_modes: string[]
          snack_action: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          slug: string
          name: string
          meal_type: string
          steps?: Json
          prep_time_min?: number | null
          requires_cooking?: boolean
          is_active?: boolean
          weighing_note?: string | null
          is_nutrient_dense?: boolean
          contains_protein_source?: boolean
          contains_fruit_or_vegetable?: boolean
          is_treat?: boolean
          allowed_schedule_modes?: string[]
          snack_action?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          slug?: string
          name?: string
          meal_type?: string
          steps?: Json
          prep_time_min?: number | null
          requires_cooking?: boolean
          is_active?: boolean
          weighing_note?: string | null
          is_nutrient_dense?: boolean
          contains_protein_source?: boolean
          contains_fruit_or_vegetable?: boolean
          is_treat?: boolean
          allowed_schedule_modes?: string[]
          snack_action?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      exercises: {
        Row: {
          category: string
          common_mistakes: Json
          created_at: string
          cues: Json
          default_reps: string
          default_sets: number
          description: string | null
          difficulty: string
          equipment: string[]
          gif_url: string | null
          id: string
          muscle_groups: string[]
          name: string
          rest_seconds: number
          slug: string
          tags: string[]
          tempo: string | null
          updated_at: string
          video_url: string | null
        }
        Insert: {
          category: string
          common_mistakes?: Json
          created_at?: string
          cues?: Json
          default_reps?: string
          default_sets?: number
          description?: string | null
          difficulty?: string
          equipment?: string[]
          gif_url?: string | null
          id?: string
          muscle_groups?: string[]
          name: string
          rest_seconds?: number
          slug: string
          tags?: string[]
          tempo?: string | null
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          category?: string
          common_mistakes?: Json
          created_at?: string
          cues?: Json
          default_reps?: string
          default_sets?: number
          description?: string | null
          difficulty?: string
          equipment?: string[]
          gif_url?: string | null
          id?: string
          muscle_groups?: string[]
          name?: string
          rest_seconds?: number
          slug?: string
          tags?: string[]
          tempo?: string | null
          updated_at?: string
          video_url?: string | null
        }
        Relationships: []
      }
      measurements: {
        Row: {
          chest_cm: number | null
          created_at: string
          hips_cm: number | null
          id: string
          measured_on: string
          note: string | null
          updated_at: string
          user_id: string
          waist_cm: number | null
          weight_kg: number | null
        }
        Insert: {
          chest_cm?: number | null
          created_at?: string
          hips_cm?: number | null
          id?: string
          measured_on?: string
          note?: string | null
          updated_at?: string
          user_id: string
          waist_cm?: number | null
          weight_kg?: number | null
        }
        Update: {
          chest_cm?: number | null
          created_at?: string
          hips_cm?: number | null
          id?: string
          measured_on?: string
          note?: string | null
          updated_at?: string
          user_id?: string
          waist_cm?: number | null
          weight_kg?: number | null
        }
        Relationships: []
      }
      weekly_check_ins: {
        Row: {
          adaptation_decision: string | null
          avg_steps: number | null
          avg_weight_kg: number | null
          created_at: string
          energy_1_10: number | null
          hips_cm: number | null
          hunger_1_10: number | null
          id: string
          notes: string | null
          nutrition_adherence_pct: number | null
          pain_reported: boolean
          sleep_hours: number | null
          training_difficulty_1_10: number | null
          updated_at: string
          user_id: string
          waist_cm: number | null
          wants_change: string | null
          week_start: string
          what_liked: string | null
          what_was_hard: string | null
          workouts_completed: number | null
          workouts_planned: number | null
        }
        Insert: {
          adaptation_decision?: string | null
          avg_steps?: number | null
          avg_weight_kg?: number | null
          created_at?: string
          energy_1_10?: number | null
          hips_cm?: number | null
          hunger_1_10?: number | null
          id?: string
          notes?: string | null
          nutrition_adherence_pct?: number | null
          pain_reported?: boolean
          sleep_hours?: number | null
          training_difficulty_1_10?: number | null
          updated_at?: string
          user_id: string
          waist_cm?: number | null
          wants_change?: string | null
          week_start: string
          what_liked?: string | null
          what_was_hard?: string | null
          workouts_completed?: number | null
          workouts_planned?: number | null
        }
        Update: {
          adaptation_decision?: string | null
          avg_steps?: number | null
          avg_weight_kg?: number | null
          created_at?: string
          energy_1_10?: number | null
          hips_cm?: number | null
          hunger_1_10?: number | null
          id?: string
          notes?: string | null
          nutrition_adherence_pct?: number | null
          pain_reported?: boolean
          sleep_hours?: number | null
          training_difficulty_1_10?: number | null
          updated_at?: string
          user_id?: string
          waist_cm?: number | null
          wants_change?: string | null
          week_start?: string
          what_liked?: string | null
          what_was_hard?: string | null
          workouts_completed?: number | null
          workouts_planned?: number | null
        }
        Relationships: []
      }
      workout_feedback: {
        Row: {
          adaptation_decision: string | null
          completed_fully: boolean
          created_at: string
          day_index: number
          day_title: string | null
          difficulty_1_10: number
          energy_before_1_10: number | null
          id: string
          notes: string | null
          pain_details: string | null
          pain_reported: boolean
          program_id: string | null
          too_easy_exercise_ids: string[]
          too_hard_exercise_ids: string[]
          user_id: string
          week_index: number
          wellbeing_after_1_10: number | null
        }
        Insert: {
          adaptation_decision?: string | null
          completed_fully?: boolean
          created_at?: string
          day_index: number
          day_title?: string | null
          difficulty_1_10: number
          energy_before_1_10?: number | null
          id?: string
          notes?: string | null
          pain_details?: string | null
          pain_reported?: boolean
          program_id?: string | null
          too_easy_exercise_ids?: string[]
          too_hard_exercise_ids?: string[]
          user_id: string
          week_index?: number
          wellbeing_after_1_10?: number | null
        }
        Update: {
          adaptation_decision?: string | null
          completed_fully?: boolean
          created_at?: string
          day_index?: number
          day_title?: string | null
          difficulty_1_10?: number
          energy_before_1_10?: number | null
          id?: string
          notes?: string | null
          pain_details?: string | null
          pain_reported?: boolean
          program_id?: string | null
          too_easy_exercise_ids?: string[]
          too_hard_exercise_ids?: string[]
          user_id?: string
          week_index?: number
          wellbeing_after_1_10?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "workout_feedback_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "training_programs"
            referencedColumns: ["id"]
          },
        ]
      }
      nutrition_plan_days: {
        Row: {
          created_at: string
          day_index: number
          day_note: string | null
          id: string
          meals: Json
          plan_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          day_index: number
          day_note?: string | null
          id?: string
          meals?: Json
          plan_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          day_index?: number
          day_note?: string | null
          id?: string
          meals?: Json
          plan_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nutrition_plan_days_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "nutrition_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      nutrition_plans: {
        Row: {
          bmr: number | null
          calorie_adjustment_pct: number | null
          course_id: string | null
          created_at: string
          excluded_products: string[]
          generated_at: string
          id: string
          meal_schedule_mode: string
          meals_per_day: number
          notes: string | null
          plan_days_count: number
          plan_mode: string
          plan_status: string
          preferred_products: string[]
          primary_meal_slot: string
          requires_manual_review: boolean
          review_reason: string | null
          target_carbs_g: number
          target_fat_g: number
          target_kcal: number
          target_protein_g: number
          targets_manual: boolean
          tdee: number | null
          tolerance_kcal: number
          tolerance_macro_g: number
          updated_at: string
          user_id: string
        }
        Insert: {
          bmr?: number | null
          calorie_adjustment_pct?: number | null
          course_id?: string | null
          created_at?: string
          excluded_products?: string[]
          generated_at?: string
          id?: string
          meal_schedule_mode?: string
          meals_per_day?: number
          notes?: string | null
          plan_days_count?: number
          plan_mode?: string
          plan_status?: string
          preferred_products?: string[]
          primary_meal_slot?: string
          requires_manual_review?: boolean
          review_reason?: string | null
          target_carbs_g: number
          target_fat_g: number
          target_kcal: number
          target_protein_g: number
          targets_manual?: boolean
          tdee?: number | null
          tolerance_kcal?: number
          tolerance_macro_g?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          bmr?: number | null
          calorie_adjustment_pct?: number | null
          course_id?: string | null
          created_at?: string
          excluded_products?: string[]
          generated_at?: string
          id?: string
          meal_schedule_mode?: string
          meals_per_day?: number
          notes?: string | null
          plan_days_count?: number
          plan_mode?: string
          plan_status?: string
          preferred_products?: string[]
          primary_meal_slot?: string
          requires_manual_review?: boolean
          review_reason?: string | null
          target_carbs_g?: number
          target_fat_g?: number
          target_kcal?: number
          target_protein_g?: number
          targets_manual?: boolean
          tdee?: number | null
          tolerance_kcal?: number
          tolerance_macro_g?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      onboarding_responses: {
        Row: {
          activity_level: string | null
          alcohol_frequency: string | null
          allergies: string | null
          completed_at: string | null
          created_at: string
          diet_type: string | null
          disliked_foods: string | null
          energy_level: number | null
          equipment: string[] | null
          expectations: string | null
          experience: string | null
          extra: Json | null
          favorite_foods: string | null
          focus_areas: string[] | null
          goal_details: string | null
          goal_primary: string | null
          has_injuries: boolean | null
          health_conditions: string | null
          id: string
          injuries_details: string | null
          job_type: string | null
          meals_per_day: number | null
          medications: string | null
          motivation: string | null
          pregnancy_status: string | null
          previous_experience: string | null
          session_duration_min: number | null
          sleep_hours: number | null
          smoking: boolean | null
          stress_level: number | null
          timeframe: string | null
          training_days_per_week: number | null
          training_location: string | null
          updated_at: string
          user_id: string
          water_liters: number | null
        }
        Insert: {
          activity_level?: string | null
          alcohol_frequency?: string | null
          allergies?: string | null
          completed_at?: string | null
          created_at?: string
          diet_type?: string | null
          disliked_foods?: string | null
          energy_level?: number | null
          equipment?: string[] | null
          expectations?: string | null
          experience?: string | null
          extra?: Json | null
          favorite_foods?: string | null
          focus_areas?: string[] | null
          goal_details?: string | null
          goal_primary?: string | null
          has_injuries?: boolean | null
          health_conditions?: string | null
          id?: string
          injuries_details?: string | null
          job_type?: string | null
          meals_per_day?: number | null
          medications?: string | null
          motivation?: string | null
          pregnancy_status?: string | null
          previous_experience?: string | null
          session_duration_min?: number | null
          sleep_hours?: number | null
          smoking?: boolean | null
          stress_level?: number | null
          timeframe?: string | null
          training_days_per_week?: number | null
          training_location?: string | null
          updated_at?: string
          user_id: string
          water_liters?: number | null
        }
        Update: {
          activity_level?: string | null
          alcohol_frequency?: string | null
          allergies?: string | null
          completed_at?: string | null
          created_at?: string
          diet_type?: string | null
          disliked_foods?: string | null
          energy_level?: number | null
          equipment?: string[] | null
          expectations?: string | null
          experience?: string | null
          extra?: Json | null
          favorite_foods?: string | null
          focus_areas?: string[] | null
          goal_details?: string | null
          goal_primary?: string | null
          has_injuries?: boolean | null
          health_conditions?: string | null
          id?: string
          injuries_details?: string | null
          job_type?: string | null
          meals_per_day?: number | null
          medications?: string | null
          motivation?: string | null
          pregnancy_status?: string | null
          previous_experience?: string | null
          session_duration_min?: number | null
          sleep_hours?: number | null
          smoking?: boolean | null
          stress_level?: number | null
          timeframe?: string | null
          training_days_per_week?: number | null
          training_location?: string | null
          updated_at?: string
          user_id?: string
          water_liters?: number | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          birth_date: string | null
          created_at: string
          full_name: string | null
          gender: string | null
          goal: string | null
          height_cm: number | null
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          birth_date?: string | null
          created_at?: string
          full_name?: string | null
          gender?: string | null
          goal?: string | null
          height_cm?: number | null
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          birth_date?: string | null
          created_at?: string
          full_name?: string | null
          gender?: string | null
          goal?: string | null
          height_cm?: number | null
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      training_program_days: {
        Row: {
          cooldown: Json
          created_at: string
          day_index: number
          day_note: string | null
          description: string | null
          exercises: Json
          focus: string | null
          id: string
          is_rest: boolean
          program_id: string
          title: string
          updated_at: string
          warmup: Json
          week_index: number
        }
        Insert: {
          cooldown?: Json
          created_at?: string
          day_index: number
          day_note?: string | null
          description?: string | null
          exercises?: Json
          focus?: string | null
          id?: string
          is_rest?: boolean
          program_id: string
          title?: string
          updated_at?: string
          warmup?: Json
          week_index?: number
        }
        Update: {
          cooldown?: Json
          created_at?: string
          day_index?: number
          day_note?: string | null
          description?: string | null
          exercises?: Json
          focus?: string | null
          id?: string
          is_rest?: boolean
          program_id?: string
          title?: string
          updated_at?: string
          warmup?: Json
          week_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "training_program_days_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "training_programs"
            referencedColumns: ["id"]
          },
        ]
      }
      training_programs: {
        Row: {
          course_id: string | null
          created_at: string
          equipment: string[]
          faq: Json
          generated_at: string
          goal: string | null
          has_injuries: boolean
          id: string
          injuries_details: string | null
          level: string
          location: string | null
          notes: string | null
          program_weeks: number
          sessions_per_week: number
          targets_manual: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          course_id?: string | null
          created_at?: string
          equipment?: string[]
          faq?: Json
          generated_at?: string
          goal?: string | null
          has_injuries?: boolean
          id?: string
          injuries_details?: string | null
          level?: string
          location?: string | null
          notes?: string | null
          program_weeks?: number
          sessions_per_week?: number
          targets_manual?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          course_id?: string | null
          created_at?: string
          equipment?: string[]
          faq?: Json
          generated_at?: string
          goal?: string | null
          has_injuries?: boolean
          id?: string
          injuries_details?: string | null
          level?: string
          location?: string | null
          notes?: string | null
          program_weeks?: number
          sessions_per_week?: number
          targets_manual?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      client_program_assignments: {
        Row: {
          id: string
          client_id: string
          course_id: string | null
          kind: string
          active_version_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: string
          client_id: string
          course_id?: string | null
          kind: string
          active_version_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: string
          client_id?: string
          course_id?: string | null
          kind?: string
          active_version_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      nutrition_plan_versions: {
        Row: {
          id: string
          client_id: string
          course_id: string | null
          version: number
          status: string
          snapshot: Json
          content_hash: string
          parent_version_id: string | null
          created_at: string
          created_by: string | null
          published_at: string | null
          published_by: string | null
        }
        Insert: {
          id?: string
          client_id: string
          course_id?: string | null
          version: number
          status: string
          snapshot: Json
          content_hash: string
          parent_version_id?: string | null
          created_at?: string
          created_by?: string | null
          published_at?: string | null
          published_by?: string | null
        }
        Update: {
          id?: string
          client_id?: string
          course_id?: string | null
          version?: number
          status?: string
          snapshot?: Json
          content_hash?: string
          parent_version_id?: string | null
          created_at?: string
          created_by?: string | null
          published_at?: string | null
          published_by?: string | null
        }
        Relationships: []
      }
      training_program_versions: {
        Row: {
          id: string
          client_id: string
          course_id: string | null
          version: number
          status: string
          snapshot: Json
          content_hash: string
          parent_version_id: string | null
          created_at: string
          created_by: string | null
          published_at: string | null
          published_by: string | null
        }
        Insert: {
          id?: string
          client_id: string
          course_id?: string | null
          version: number
          status: string
          snapshot: Json
          content_hash: string
          parent_version_id?: string | null
          created_at?: string
          created_by?: string | null
          published_at?: string | null
          published_by?: string | null
        }
        Update: {
          id?: string
          client_id?: string
          course_id?: string | null
          version?: number
          status?: string
          snapshot?: Json
          content_hash?: string
          parent_version_id?: string | null
          created_at?: string
          created_by?: string | null
          published_at?: string | null
          published_by?: string | null
        }
        Relationships: []
      }
      nutrition_recommendations: {
        Row: {
          id: string
          client_id: string
          measurement_id: string | null
          based_on_version_id: string | null
          status: string
          assigned_kcal: number
          assigned_protein_g: number
          assigned_fat_g: number
          assigned_carbs_g: number
          recommended_kcal: number
          recommended_protein_g: number
          recommended_fat_g: number
          recommended_carbs_g: number
          assigned_weight_kg: number | null
          new_weight_kg: number | null
          bmr: number
          tdee: number
          reason: string | null
          created_at: string
          reviewed_at: string | null
          reviewed_by: string | null
        }
        Insert: {
          id?: string
          client_id: string
          measurement_id?: string | null
          based_on_version_id?: string | null
          status?: string
          assigned_kcal?: number
          assigned_protein_g?: number
          assigned_fat_g?: number
          assigned_carbs_g?: number
          recommended_kcal: number
          recommended_protein_g: number
          recommended_fat_g: number
          recommended_carbs_g: number
          assigned_weight_kg?: number | null
          new_weight_kg?: number | null
          bmr: number
          tdee: number
          reason?: string | null
          created_at?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
        }
        Update: {
          id?: string
          client_id?: string
          measurement_id?: string | null
          based_on_version_id?: string | null
          status?: string
          assigned_kcal?: number
          assigned_protein_g?: number
          assigned_fat_g?: number
          assigned_carbs_g?: number
          recommended_kcal?: number
          recommended_protein_g?: number
          recommended_fat_g?: number
          recommended_carbs_g?: number
          assigned_weight_kg?: number | null
          new_weight_kg?: number | null
          bmr?: number
          tdee?: number
          reason?: string | null
          created_at?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
        }
        Relationships: []
      }
      program_change_log: {
        Row: {
          id: string
          client_id: string
          kind: string
          action: string
          actor_id: string | null
          from_version_id: string | null
          to_version_id: string | null
          measurement_id: string | null
          diff: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          client_id: string
          kind: string
          action: string
          actor_id?: string | null
          from_version_id?: string | null
          to_version_id?: string | null
          measurement_id?: string | null
          diff?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          client_id?: string
          kind?: string
          action?: string
          actor_id?: string | null
          from_version_id?: string | null
          to_version_id?: string | null
          measurement_id?: string | null
          diff?: Json | null
          created_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      replace_training_program_days: {
        Args: {
          p_program_id: string
          p_rows: Json
        }
        Returns: number
      }
      publish_nutrition_version: {
        Args: {
          p_client_id: string
          p_snapshot: Json
          p_content_hash: string
          p_reason?: string
          p_measurement_id?: string
          p_recommendation_id?: string
        }
        Returns: string
      }
      publish_training_version: {
        Args: {
          p_client_id: string
          p_snapshot: Json
          p_content_hash: string
          p_reason?: string
        }
        Returns: string
      }
    }
    Enums: {
      app_role: "admin" | "client"
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
      app_role: ["admin", "client"],
    },
  },
} as const
