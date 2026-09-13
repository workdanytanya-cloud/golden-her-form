export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      admin_notifications: {
        Row: {
          client_id: string;
          created_at: string;
          id: string;
          is_read: boolean;
          measurement_id: string | null;
          message: string;
          type: string;
        };
        Insert: {
          client_id: string;
          created_at?: string;
          id?: string;
          is_read?: boolean;
          measurement_id?: string | null;
          message: string;
          type?: string;
        };
        Update: {
          client_id?: string;
          created_at?: string;
          id?: string;
          is_read?: boolean;
          measurement_id?: string | null;
          message?: string;
          type?: string;
        };
        Relationships: [];
      };
      client_access: {
        Row: {
          activated_at: string | null;
          activated_by: string | null;
          created_at: string;
          notes: string | null;
          status: string;
          unlock_source: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          activated_at?: string | null;
          activated_by?: string | null;
          created_at?: string;
          notes?: string | null;
          status?: string;
          unlock_source?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          activated_at?: string | null;
          activated_by?: string | null;
          created_at?: string;
          notes?: string | null;
          status?: string;
          unlock_source?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      client_courses: {
        Row: {
          client_id: string;
          created_at: string;
          created_by: string | null;
          end_date: string;
          id: string;
          notes: string | null;
          start_date: string;
          status: string;
          title: string;
        };
        Insert: {
          client_id: string;
          created_at?: string;
          created_by?: string | null;
          end_date: string;
          id?: string;
          notes?: string | null;
          start_date: string;
          status?: string;
          title: string;
        };
        Update: {
          client_id?: string;
          created_at?: string;
          created_by?: string | null;
          end_date?: string;
          id?: string;
          notes?: string | null;
          start_date?: string;
          status?: string;
          title?: string;
        };
        Relationships: [];
      };
      client_notifications: {
        Row: {
          created_at: string;
          id: string;
          is_read: boolean;
          link: string | null;
          message: string;
          type: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_read?: boolean;
          link?: string | null;
          message: string;
          type: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_read?: boolean;
          link?: string | null;
          message?: string;
          type?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      client_program_assignments: {
        Row: {
          active_version_id: string;
          client_id: string;
          course_id: string | null;
          id: string;
          kind: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          active_version_id: string;
          client_id: string;
          course_id?: string | null;
          id?: string;
          kind: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          active_version_id?: string;
          client_id?: string;
          course_id?: string | null;
          id?: string;
          kind?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "client_program_assignments_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "client_courses";
            referencedColumns: ["id"];
          },
        ];
      };
      dishes: {
        Row: {
          calories_per_100g: number;
          carbs_per_100g: number;
          created_at: string;
          description: string | null;
          fat_per_100g: number;
          id: string;
          image_url: string | null;
          ingredients: Json;
          meal_type: string;
          name: string;
          portion_weight_g: number;
          protein_per_100g: number;
          replacements: string[];
          slug: string;
          steps: Json;
          tags: string[];
          updated_at: string;
          video_url: string | null;
        };
        Insert: {
          calories_per_100g: number;
          carbs_per_100g: number;
          created_at?: string;
          description?: string | null;
          fat_per_100g: number;
          id?: string;
          image_url?: string | null;
          ingredients?: Json;
          meal_type: string;
          name: string;
          portion_weight_g: number;
          protein_per_100g: number;
          replacements?: string[];
          slug: string;
          steps?: Json;
          tags?: string[];
          updated_at?: string;
          video_url?: string | null;
        };
        Update: {
          calories_per_100g?: number;
          carbs_per_100g?: number;
          created_at?: string;
          description?: string | null;
          fat_per_100g?: number;
          id?: string;
          image_url?: string | null;
          ingredients?: Json;
          meal_type?: string;
          name?: string;
          portion_weight_g?: number;
          protein_per_100g?: number;
          replacements?: string[];
          slug?: string;
          steps?: Json;
          tags?: string[];
          updated_at?: string;
          video_url?: string | null;
        };
        Relationships: [];
      };
      exercises: {
        Row: {
          category: string;
          common_mistakes: Json;
          created_at: string;
          cues: Json;
          default_reps: string;
          default_sets: number;
          description: string | null;
          difficulty: string;
          equipment: string[];
          gif_url: string | null;
          id: string;
          muscle_groups: string[];
          name: string;
          rest_seconds: number;
          slug: string;
          tags: string[];
          tempo: string | null;
          updated_at: string;
          video_url: string | null;
        };
        Insert: {
          category: string;
          common_mistakes?: Json;
          created_at?: string;
          cues?: Json;
          default_reps?: string;
          default_sets?: number;
          description?: string | null;
          difficulty?: string;
          equipment?: string[];
          gif_url?: string | null;
          id?: string;
          muscle_groups?: string[];
          name: string;
          rest_seconds?: number;
          slug: string;
          tags?: string[];
          tempo?: string | null;
          updated_at?: string;
          video_url?: string | null;
        };
        Update: {
          category?: string;
          common_mistakes?: Json;
          created_at?: string;
          cues?: Json;
          default_reps?: string;
          default_sets?: number;
          description?: string | null;
          difficulty?: string;
          equipment?: string[];
          gif_url?: string | null;
          id?: string;
          muscle_groups?: string[];
          name?: string;
          rest_seconds?: number;
          slug?: string;
          tags?: string[];
          tempo?: string | null;
          updated_at?: string;
          video_url?: string | null;
        };
        Relationships: [];
      };
      food_products: {
        Row: {
          allergen_tags: string[];
          allowed_for_snack: boolean;
          brand: string | null;
          carbs_per_100g: number;
          category: string;
          created_at: string;
          density: number | null;
          fat_per_100g: number;
          fiber_per_100g: number | null;
          id: string;
          is_active: boolean;
          is_active_for_autogeneration: boolean;
          is_verified: boolean;
          kcal_per_100g: number;
          may_contain_traces: string[];
          measurement_basis: string;
          name: string;
          product_group: string | null;
          protein_per_100g: number;
          requires_cooking: boolean;
          slug: string;
          source_name: string;
          source_url: string | null;
          state: string;
          updated_at: string;
          verified_at: string | null;
          weighing_note: string | null;
        };
        Insert: {
          allergen_tags?: string[];
          allowed_for_snack?: boolean;
          brand?: string | null;
          carbs_per_100g: number;
          category: string;
          created_at?: string;
          density?: number | null;
          fat_per_100g: number;
          fiber_per_100g?: number | null;
          id?: string;
          is_active?: boolean;
          is_active_for_autogeneration?: boolean;
          is_verified?: boolean;
          kcal_per_100g: number;
          may_contain_traces?: string[];
          measurement_basis: string;
          name: string;
          product_group?: string | null;
          protein_per_100g: number;
          requires_cooking?: boolean;
          slug: string;
          source_name: string;
          source_url?: string | null;
          state: string;
          updated_at?: string;
          verified_at?: string | null;
          weighing_note?: string | null;
        };
        Update: {
          allergen_tags?: string[];
          allowed_for_snack?: boolean;
          brand?: string | null;
          carbs_per_100g?: number;
          category?: string;
          created_at?: string;
          density?: number | null;
          fat_per_100g?: number;
          fiber_per_100g?: number | null;
          id?: string;
          is_active?: boolean;
          is_active_for_autogeneration?: boolean;
          is_verified?: boolean;
          kcal_per_100g?: number;
          may_contain_traces?: string[];
          measurement_basis?: string;
          name?: string;
          product_group?: string | null;
          protein_per_100g?: number;
          requires_cooking?: boolean;
          slug?: string;
          source_name?: string;
          source_url?: string | null;
          state?: string;
          updated_at?: string;
          verified_at?: string | null;
          weighing_note?: string | null;
        };
        Relationships: [];
      };
      leads: {
        Row: {
          age: number;
          created_at: string;
          email: string;
          full_name: string;
          id: string;
          message: string | null;
          messenger: string;
          notes: string | null;
          phone: string;
          program_slug: string | null;
          program_title: string | null;
          source: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          age: number;
          created_at?: string;
          email: string;
          full_name: string;
          id?: string;
          message?: string | null;
          messenger?: string;
          notes?: string | null;
          phone: string;
          program_slug?: string | null;
          program_title?: string | null;
          source?: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          age?: number;
          created_at?: string;
          email?: string;
          full_name?: string;
          id?: string;
          message?: string | null;
          messenger?: string;
          notes?: string | null;
          phone?: string;
          program_slug?: string | null;
          program_title?: string | null;
          source?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      meal_plan_item_ingredients: {
        Row: {
          carbs_g: number;
          carbs_per_100g: number;
          fat_g: number;
          fat_per_100g: number;
          fiber_g: number;
          fiber_per_100g: number | null;
          grams: number;
          id: string;
          kcal: number;
          kcal_per_100g: number;
          meal_item_id: string;
          product_id: string | null;
          product_name: string;
          protein_g: number;
          protein_per_100g: number;
          sort_order: number;
          weighing_note: string | null;
        };
        Insert: {
          carbs_g: number;
          carbs_per_100g: number;
          fat_g: number;
          fat_per_100g: number;
          fiber_g?: number;
          fiber_per_100g?: number | null;
          grams: number;
          id?: string;
          kcal: number;
          kcal_per_100g: number;
          meal_item_id: string;
          product_id?: string | null;
          product_name: string;
          protein_g: number;
          protein_per_100g: number;
          sort_order?: number;
          weighing_note?: string | null;
        };
        Update: {
          carbs_g?: number;
          carbs_per_100g?: number;
          fat_g?: number;
          fat_per_100g?: number;
          fiber_g?: number;
          fiber_per_100g?: number | null;
          grams?: number;
          id?: string;
          kcal?: number;
          kcal_per_100g?: number;
          meal_item_id?: string;
          product_id?: string | null;
          product_name?: string;
          protein_g?: number;
          protein_per_100g?: number;
          sort_order?: number;
          weighing_note?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "meal_plan_item_ingredients_meal_item_id_fkey";
            columns: ["meal_item_id"];
            isOneToOne: false;
            referencedRelation: "meal_plan_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "meal_plan_item_ingredients_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "food_products";
            referencedColumns: ["id"];
          },
        ];
      };
      meal_plan_items: {
        Row: {
          carbs_g: number;
          created_at: string;
          fat_g: number;
          fiber_g: number;
          id: string;
          is_valid: boolean;
          kcal: number;
          plan_day_id: string;
          prep_time_min: number | null;
          protein_g: number;
          recipe_id: string | null;
          recipe_name: string;
          requires_cooking: boolean;
          slot: string;
          snack_action: string | null;
          sort_order: number;
          steps: Json;
          weighing_note: string | null;
        };
        Insert: {
          carbs_g: number;
          created_at?: string;
          fat_g: number;
          fiber_g?: number;
          id?: string;
          is_valid?: boolean;
          kcal: number;
          plan_day_id: string;
          prep_time_min?: number | null;
          protein_g: number;
          recipe_id?: string | null;
          recipe_name: string;
          requires_cooking?: boolean;
          slot: string;
          snack_action?: string | null;
          sort_order?: number;
          steps?: Json;
          weighing_note?: string | null;
        };
        Update: {
          carbs_g?: number;
          created_at?: string;
          fat_g?: number;
          fiber_g?: number;
          id?: string;
          is_valid?: boolean;
          kcal?: number;
          plan_day_id?: string;
          prep_time_min?: number | null;
          protein_g?: number;
          recipe_id?: string | null;
          recipe_name?: string;
          requires_cooking?: boolean;
          slot?: string;
          snack_action?: string | null;
          sort_order?: number;
          steps?: Json;
          weighing_note?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "meal_plan_items_plan_day_id_fkey";
            columns: ["plan_day_id"];
            isOneToOne: false;
            referencedRelation: "nutrition_plan_days";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "meal_plan_items_recipe_id_fkey";
            columns: ["recipe_id"];
            isOneToOne: false;
            referencedRelation: "recipes";
            referencedColumns: ["id"];
          },
        ];
      };
      measurements: {
        Row: {
          chest_cm: number | null;
          created_at: string;
          hips_cm: number | null;
          id: string;
          measured_on: string;
          note: string | null;
          updated_at: string;
          user_id: string;
          waist_cm: number | null;
          weight_kg: number | null;
        };
        Insert: {
          chest_cm?: number | null;
          created_at?: string;
          hips_cm?: number | null;
          id?: string;
          measured_on?: string;
          note?: string | null;
          updated_at?: string;
          user_id: string;
          waist_cm?: number | null;
          weight_kg?: number | null;
        };
        Update: {
          chest_cm?: number | null;
          created_at?: string;
          hips_cm?: number | null;
          id?: string;
          measured_on?: string;
          note?: string | null;
          updated_at?: string;
          user_id?: string;
          waist_cm?: number | null;
          weight_kg?: number | null;
        };
        Relationships: [];
      };
      nutrition_plan_days: {
        Row: {
          created_at: string;
          day_index: number;
          day_note: string | null;
          id: string;
          meals: Json;
          plan_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          day_index: number;
          day_note?: string | null;
          id?: string;
          meals?: Json;
          plan_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          day_index?: number;
          day_note?: string | null;
          id?: string;
          meals?: Json;
          plan_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "nutrition_plan_days_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "nutrition_plans";
            referencedColumns: ["id"];
          },
        ];
      };
      nutrition_plan_versions: {
        Row: {
          client_id: string;
          content_hash: string;
          course_id: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          parent_version_id: string | null;
          published_at: string | null;
          published_by: string | null;
          snapshot: Json;
          status: string;
          version: number;
        };
        Insert: {
          client_id: string;
          content_hash: string;
          course_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          parent_version_id?: string | null;
          published_at?: string | null;
          published_by?: string | null;
          snapshot: Json;
          status: string;
          version: number;
        };
        Update: {
          client_id?: string;
          content_hash?: string;
          course_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          parent_version_id?: string | null;
          published_at?: string | null;
          published_by?: string | null;
          snapshot?: Json;
          status?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "nutrition_plan_versions_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "client_courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "nutrition_plan_versions_parent_version_id_fkey";
            columns: ["parent_version_id"];
            isOneToOne: false;
            referencedRelation: "nutrition_plan_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      nutrition_plans: {
        Row: {
          bmr: number | null;
          calorie_adjustment_pct: number | null;
          course_id: string | null;
          created_at: string;
          excluded_products: string[];
          generated_at: string;
          id: string;
          meal_schedule_mode: string;
          meals_per_day: number;
          notes: string | null;
          plan_days_count: number;
          plan_mode: string;
          plan_status: string;
          preferred_products: string[];
          primary_meal_slot: string;
          requires_manual_review: boolean;
          review_reason: string | null;
          target_carbs_g: number;
          target_fat_g: number;
          target_kcal: number;
          target_protein_g: number;
          targets_manual: boolean;
          tdee: number | null;
          tolerance_kcal: number;
          tolerance_macro_g: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          bmr?: number | null;
          calorie_adjustment_pct?: number | null;
          course_id?: string | null;
          created_at?: string;
          excluded_products?: string[];
          generated_at?: string;
          id?: string;
          meal_schedule_mode?: string;
          meals_per_day?: number;
          notes?: string | null;
          plan_days_count?: number;
          plan_mode?: string;
          plan_status?: string;
          preferred_products?: string[];
          primary_meal_slot?: string;
          requires_manual_review?: boolean;
          review_reason?: string | null;
          target_carbs_g: number;
          target_fat_g: number;
          target_kcal: number;
          target_protein_g: number;
          targets_manual?: boolean;
          tdee?: number | null;
          tolerance_kcal?: number;
          tolerance_macro_g?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          bmr?: number | null;
          calorie_adjustment_pct?: number | null;
          course_id?: string | null;
          created_at?: string;
          excluded_products?: string[];
          generated_at?: string;
          id?: string;
          meal_schedule_mode?: string;
          meals_per_day?: number;
          notes?: string | null;
          plan_days_count?: number;
          plan_mode?: string;
          plan_status?: string;
          preferred_products?: string[];
          primary_meal_slot?: string;
          requires_manual_review?: boolean;
          review_reason?: string | null;
          target_carbs_g?: number;
          target_fat_g?: number;
          target_kcal?: number;
          target_protein_g?: number;
          targets_manual?: boolean;
          tdee?: number | null;
          tolerance_kcal?: number;
          tolerance_macro_g?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "nutrition_plans_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "client_courses";
            referencedColumns: ["id"];
          },
        ];
      };
      nutrition_recommendations: {
        Row: {
          assigned_carbs_g: number;
          assigned_fat_g: number;
          assigned_kcal: number;
          assigned_protein_g: number;
          assigned_weight_kg: number | null;
          based_on_version_id: string | null;
          bmr: number;
          client_id: string;
          created_at: string;
          id: string;
          measurement_id: string | null;
          new_weight_kg: number | null;
          reason: string | null;
          recommended_carbs_g: number;
          recommended_fat_g: number;
          recommended_kcal: number;
          recommended_protein_g: number;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: string;
          tdee: number;
        };
        Insert: {
          assigned_carbs_g?: number;
          assigned_fat_g?: number;
          assigned_kcal?: number;
          assigned_protein_g?: number;
          assigned_weight_kg?: number | null;
          based_on_version_id?: string | null;
          bmr: number;
          client_id: string;
          created_at?: string;
          id?: string;
          measurement_id?: string | null;
          new_weight_kg?: number | null;
          reason?: string | null;
          recommended_carbs_g: number;
          recommended_fat_g: number;
          recommended_kcal: number;
          recommended_protein_g: number;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          tdee: number;
        };
        Update: {
          assigned_carbs_g?: number;
          assigned_fat_g?: number;
          assigned_kcal?: number;
          assigned_protein_g?: number;
          assigned_weight_kg?: number | null;
          based_on_version_id?: string | null;
          bmr?: number;
          client_id?: string;
          created_at?: string;
          id?: string;
          measurement_id?: string | null;
          new_weight_kg?: number | null;
          reason?: string | null;
          recommended_carbs_g?: number;
          recommended_fat_g?: number;
          recommended_kcal?: number;
          recommended_protein_g?: number;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          tdee?: number;
        };
        Relationships: [
          {
            foreignKeyName: "nutrition_recommendations_based_on_version_id_fkey";
            columns: ["based_on_version_id"];
            isOneToOne: false;
            referencedRelation: "nutrition_plan_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "nutrition_recommendations_measurement_id_fkey";
            columns: ["measurement_id"];
            isOneToOne: false;
            referencedRelation: "measurements";
            referencedColumns: ["id"];
          },
        ];
      };
      onboarding_responses: {
        Row: {
          activity_level: string | null;
          alcohol_frequency: string | null;
          allergies: string | null;
          completed_at: string | null;
          created_at: string;
          diet_type: string | null;
          disliked_foods: string | null;
          energy_level: number | null;
          equipment: string[] | null;
          expectations: string | null;
          experience: string | null;
          extra: Json | null;
          favorite_foods: string | null;
          focus_areas: string[] | null;
          goal_details: string | null;
          goal_primary: string | null;
          has_injuries: boolean | null;
          health_conditions: string | null;
          id: string;
          injuries_details: string | null;
          job_type: string | null;
          meals_per_day: number | null;
          medications: string | null;
          motivation: string | null;
          pregnancy_status: string | null;
          previous_experience: string | null;
          session_duration_min: number | null;
          sleep_hours: number | null;
          smoking: boolean | null;
          stress_level: number | null;
          timeframe: string | null;
          training_days_per_week: number | null;
          training_location: string | null;
          updated_at: string;
          user_id: string;
          water_liters: number | null;
        };
        Insert: {
          activity_level?: string | null;
          alcohol_frequency?: string | null;
          allergies?: string | null;
          completed_at?: string | null;
          created_at?: string;
          diet_type?: string | null;
          disliked_foods?: string | null;
          energy_level?: number | null;
          equipment?: string[] | null;
          expectations?: string | null;
          experience?: string | null;
          extra?: Json | null;
          favorite_foods?: string | null;
          focus_areas?: string[] | null;
          goal_details?: string | null;
          goal_primary?: string | null;
          has_injuries?: boolean | null;
          health_conditions?: string | null;
          id?: string;
          injuries_details?: string | null;
          job_type?: string | null;
          meals_per_day?: number | null;
          medications?: string | null;
          motivation?: string | null;
          pregnancy_status?: string | null;
          previous_experience?: string | null;
          session_duration_min?: number | null;
          sleep_hours?: number | null;
          smoking?: boolean | null;
          stress_level?: number | null;
          timeframe?: string | null;
          training_days_per_week?: number | null;
          training_location?: string | null;
          updated_at?: string;
          user_id: string;
          water_liters?: number | null;
        };
        Update: {
          activity_level?: string | null;
          alcohol_frequency?: string | null;
          allergies?: string | null;
          completed_at?: string | null;
          created_at?: string;
          diet_type?: string | null;
          disliked_foods?: string | null;
          energy_level?: number | null;
          equipment?: string[] | null;
          expectations?: string | null;
          experience?: string | null;
          extra?: Json | null;
          favorite_foods?: string | null;
          focus_areas?: string[] | null;
          goal_details?: string | null;
          goal_primary?: string | null;
          has_injuries?: boolean | null;
          health_conditions?: string | null;
          id?: string;
          injuries_details?: string | null;
          job_type?: string | null;
          meals_per_day?: number | null;
          medications?: string | null;
          motivation?: string | null;
          pregnancy_status?: string | null;
          previous_experience?: string | null;
          session_duration_min?: number | null;
          sleep_hours?: number | null;
          smoking?: boolean | null;
          stress_level?: number | null;
          timeframe?: string | null;
          training_days_per_week?: number | null;
          training_location?: string | null;
          updated_at?: string;
          user_id?: string;
          water_liters?: number | null;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          birth_date: string | null;
          can_reheat_food: boolean | null;
          can_take_food_to_work: boolean | null;
          created_at: string;
          disliked_products: string[];
          excluded_food_products: string[];
          food_allergies: string[];
          food_intolerances: string[];
          full_name: string | null;
          gender: string | null;
          goal: string | null;
          height_cm: number | null;
          id: string;
          max_prep_minutes: number | null;
          phone: string | null;
          preferred_main_meal_time: string | null;
          preferred_meal_schedule: string | null;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          birth_date?: string | null;
          can_reheat_food?: boolean | null;
          can_take_food_to_work?: boolean | null;
          created_at?: string;
          disliked_products?: string[];
          excluded_food_products?: string[];
          food_allergies?: string[];
          food_intolerances?: string[];
          full_name?: string | null;
          gender?: string | null;
          goal?: string | null;
          height_cm?: number | null;
          id: string;
          max_prep_minutes?: number | null;
          phone?: string | null;
          preferred_main_meal_time?: string | null;
          preferred_meal_schedule?: string | null;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          birth_date?: string | null;
          can_reheat_food?: boolean | null;
          can_take_food_to_work?: boolean | null;
          created_at?: string;
          disliked_products?: string[];
          excluded_food_products?: string[];
          food_allergies?: string[];
          food_intolerances?: string[];
          full_name?: string | null;
          gender?: string | null;
          goal?: string | null;
          height_cm?: number | null;
          id?: string;
          max_prep_minutes?: number | null;
          phone?: string | null;
          preferred_main_meal_time?: string | null;
          preferred_meal_schedule?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      program_change_log: {
        Row: {
          action: string;
          actor_id: string | null;
          client_id: string;
          created_at: string;
          diff: Json | null;
          from_version_id: string | null;
          id: string;
          kind: string;
          measurement_id: string | null;
          to_version_id: string | null;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          client_id: string;
          created_at?: string;
          diff?: Json | null;
          from_version_id?: string | null;
          id?: string;
          kind: string;
          measurement_id?: string | null;
          to_version_id?: string | null;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          client_id?: string;
          created_at?: string;
          diff?: Json | null;
          from_version_id?: string | null;
          id?: string;
          kind?: string;
          measurement_id?: string | null;
          to_version_id?: string | null;
        };
        Relationships: [];
      };
      promo_codes: {
        Row: {
          code: string;
          created_at: string;
          created_by: string | null;
          expires_at: string | null;
          id: string;
          label: string | null;
          notes: string | null;
          program_slug: string | null;
          program_title: string | null;
          status: string;
          used_at: string | null;
          used_by: string | null;
        };
        Insert: {
          code: string;
          created_at?: string;
          created_by?: string | null;
          expires_at?: string | null;
          id?: string;
          label?: string | null;
          notes?: string | null;
          program_slug?: string | null;
          program_title?: string | null;
          status?: string;
          used_at?: string | null;
          used_by?: string | null;
        };
        Update: {
          code?: string;
          created_at?: string;
          created_by?: string | null;
          expires_at?: string | null;
          id?: string;
          label?: string | null;
          notes?: string | null;
          program_slug?: string | null;
          program_title?: string | null;
          status?: string;
          used_at?: string | null;
          used_by?: string | null;
        };
        Relationships: [];
      };
      recipe_ingredients: {
        Row: {
          default_g: number | null;
          id: string;
          is_scalable: boolean;
          max_g: number;
          min_g: number;
          optional: boolean;
          product_id: string;
          recipe_id: string;
          sort_order: number;
        };
        Insert: {
          default_g?: number | null;
          id?: string;
          is_scalable?: boolean;
          max_g: number;
          min_g: number;
          optional?: boolean;
          product_id: string;
          recipe_id: string;
          sort_order?: number;
        };
        Update: {
          default_g?: number | null;
          id?: string;
          is_scalable?: boolean;
          max_g?: number;
          min_g?: number;
          optional?: boolean;
          product_id?: string;
          recipe_id?: string;
          sort_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: "recipe_ingredients_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "food_products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recipe_ingredients_recipe_id_fkey";
            columns: ["recipe_id"];
            isOneToOne: false;
            referencedRelation: "recipes";
            referencedColumns: ["id"];
          },
        ];
      };
      recipes: {
        Row: {
          active_prep_minutes: number | null;
          allowed_schedule_modes: string[];
          complexity: string | null;
          contains_fruit_or_vegetable: boolean;
          contains_protein_source: boolean;
          created_at: string;
          dietitian_approved: boolean;
          id: string;
          is_active: boolean;
          is_batch_cookable: boolean;
          is_everyday: boolean;
          is_nutrient_dense: boolean;
          is_nutritionally_complete: boolean;
          is_portable: boolean;
          is_treat: boolean;
          is_work_friendly: boolean;
          meal_type: string;
          name: string;
          prep_time_min: number | null;
          required_equipment: string[];
          requires_cooking: boolean;
          requires_reheating: boolean;
          slug: string;
          snack_action: string | null;
          steps: Json;
          total_cook_minutes: number | null;
          updated_at: string;
          weighing_note: string | null;
        };
        Insert: {
          active_prep_minutes?: number | null;
          allowed_schedule_modes?: string[];
          complexity?: string | null;
          contains_fruit_or_vegetable?: boolean;
          contains_protein_source?: boolean;
          created_at?: string;
          dietitian_approved?: boolean;
          id?: string;
          is_active?: boolean;
          is_batch_cookable?: boolean;
          is_everyday?: boolean;
          is_nutrient_dense?: boolean;
          is_nutritionally_complete?: boolean;
          is_portable?: boolean;
          is_treat?: boolean;
          is_work_friendly?: boolean;
          meal_type: string;
          name: string;
          prep_time_min?: number | null;
          required_equipment?: string[];
          requires_cooking?: boolean;
          requires_reheating?: boolean;
          slug: string;
          snack_action?: string | null;
          steps?: Json;
          total_cook_minutes?: number | null;
          updated_at?: string;
          weighing_note?: string | null;
        };
        Update: {
          active_prep_minutes?: number | null;
          allowed_schedule_modes?: string[];
          complexity?: string | null;
          contains_fruit_or_vegetable?: boolean;
          contains_protein_source?: boolean;
          created_at?: string;
          dietitian_approved?: boolean;
          id?: string;
          is_active?: boolean;
          is_batch_cookable?: boolean;
          is_everyday?: boolean;
          is_nutrient_dense?: boolean;
          is_nutritionally_complete?: boolean;
          is_portable?: boolean;
          is_treat?: boolean;
          is_work_friendly?: boolean;
          meal_type?: string;
          name?: string;
          prep_time_min?: number | null;
          required_equipment?: string[];
          requires_cooking?: boolean;
          requires_reheating?: boolean;
          slug?: string;
          snack_action?: string | null;
          steps?: Json;
          total_cook_minutes?: number | null;
          updated_at?: string;
          weighing_note?: string | null;
        };
        Relationships: [];
      };
      training_program_days: {
        Row: {
          cooldown: Json;
          created_at: string;
          day_index: number;
          day_note: string | null;
          description: string | null;
          exercises: Json;
          focus: string | null;
          id: string;
          is_rest: boolean;
          program_id: string;
          title: string;
          updated_at: string;
          warmup: Json;
          week_index: number;
        };
        Insert: {
          cooldown?: Json;
          created_at?: string;
          day_index: number;
          day_note?: string | null;
          description?: string | null;
          exercises?: Json;
          focus?: string | null;
          id?: string;
          is_rest?: boolean;
          program_id: string;
          title?: string;
          updated_at?: string;
          warmup?: Json;
          week_index?: number;
        };
        Update: {
          cooldown?: Json;
          created_at?: string;
          day_index?: number;
          day_note?: string | null;
          description?: string | null;
          exercises?: Json;
          focus?: string | null;
          id?: string;
          is_rest?: boolean;
          program_id?: string;
          title?: string;
          updated_at?: string;
          warmup?: Json;
          week_index?: number;
        };
        Relationships: [
          {
            foreignKeyName: "training_program_days_program_id_fkey";
            columns: ["program_id"];
            isOneToOne: false;
            referencedRelation: "training_programs";
            referencedColumns: ["id"];
          },
        ];
      };
      training_program_versions: {
        Row: {
          client_id: string;
          content_hash: string;
          course_id: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          parent_version_id: string | null;
          published_at: string | null;
          published_by: string | null;
          snapshot: Json;
          status: string;
          version: number;
        };
        Insert: {
          client_id: string;
          content_hash: string;
          course_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          parent_version_id?: string | null;
          published_at?: string | null;
          published_by?: string | null;
          snapshot: Json;
          status: string;
          version: number;
        };
        Update: {
          client_id?: string;
          content_hash?: string;
          course_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          parent_version_id?: string | null;
          published_at?: string | null;
          published_by?: string | null;
          snapshot?: Json;
          status?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "training_program_versions_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "client_courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "training_program_versions_parent_version_id_fkey";
            columns: ["parent_version_id"];
            isOneToOne: false;
            referencedRelation: "training_program_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      training_programs: {
        Row: {
          course_id: string | null;
          created_at: string;
          equipment: string[];
          faq: Json;
          generated_at: string;
          goal: string | null;
          has_injuries: boolean;
          id: string;
          injuries_details: string | null;
          level: string;
          location: string | null;
          notes: string | null;
          program_weeks: number;
          sessions_per_week: number;
          targets_manual: boolean;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          course_id?: string | null;
          created_at?: string;
          equipment?: string[];
          faq?: Json;
          generated_at?: string;
          goal?: string | null;
          has_injuries?: boolean;
          id?: string;
          injuries_details?: string | null;
          level?: string;
          location?: string | null;
          notes?: string | null;
          program_weeks?: number;
          sessions_per_week?: number;
          targets_manual?: boolean;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          course_id?: string | null;
          created_at?: string;
          equipment?: string[];
          faq?: Json;
          generated_at?: string;
          goal?: string | null;
          has_injuries?: boolean;
          id?: string;
          injuries_details?: string | null;
          level?: string;
          location?: string | null;
          notes?: string | null;
          program_weeks?: number;
          sessions_per_week?: number;
          targets_manual?: boolean;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "training_programs_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "client_courses";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
      weekly_check_ins: {
        Row: {
          adaptation_decision: string | null;
          avg_steps: number | null;
          avg_weight_kg: number | null;
          created_at: string;
          energy_1_10: number | null;
          hips_cm: number | null;
          hunger_1_10: number | null;
          id: string;
          notes: string | null;
          nutrition_adherence_pct: number | null;
          pain_reported: boolean;
          sleep_hours: number | null;
          training_difficulty_1_10: number | null;
          updated_at: string;
          user_id: string;
          waist_cm: number | null;
          wants_change: string | null;
          week_start: string;
          what_liked: string | null;
          what_was_hard: string | null;
          workouts_completed: number | null;
          workouts_planned: number | null;
        };
        Insert: {
          adaptation_decision?: string | null;
          avg_steps?: number | null;
          avg_weight_kg?: number | null;
          created_at?: string;
          energy_1_10?: number | null;
          hips_cm?: number | null;
          hunger_1_10?: number | null;
          id?: string;
          notes?: string | null;
          nutrition_adherence_pct?: number | null;
          pain_reported?: boolean;
          sleep_hours?: number | null;
          training_difficulty_1_10?: number | null;
          updated_at?: string;
          user_id: string;
          waist_cm?: number | null;
          wants_change?: string | null;
          week_start: string;
          what_liked?: string | null;
          what_was_hard?: string | null;
          workouts_completed?: number | null;
          workouts_planned?: number | null;
        };
        Update: {
          adaptation_decision?: string | null;
          avg_steps?: number | null;
          avg_weight_kg?: number | null;
          created_at?: string;
          energy_1_10?: number | null;
          hips_cm?: number | null;
          hunger_1_10?: number | null;
          id?: string;
          notes?: string | null;
          nutrition_adherence_pct?: number | null;
          pain_reported?: boolean;
          sleep_hours?: number | null;
          training_difficulty_1_10?: number | null;
          updated_at?: string;
          user_id?: string;
          waist_cm?: number | null;
          wants_change?: string | null;
          week_start?: string;
          what_liked?: string | null;
          what_was_hard?: string | null;
          workouts_completed?: number | null;
          workouts_planned?: number | null;
        };
        Relationships: [];
      };
      workout_feedback: {
        Row: {
          adaptation_decision: string | null;
          completed_fully: boolean;
          created_at: string;
          day_index: number;
          day_title: string | null;
          difficulty_1_10: number;
          energy_before_1_10: number | null;
          id: string;
          notes: string | null;
          pain_details: string | null;
          pain_reported: boolean;
          program_id: string | null;
          too_easy_exercise_ids: string[];
          too_hard_exercise_ids: string[];
          user_id: string;
          week_index: number;
          wellbeing_after_1_10: number | null;
        };
        Insert: {
          adaptation_decision?: string | null;
          completed_fully?: boolean;
          created_at?: string;
          day_index: number;
          day_title?: string | null;
          difficulty_1_10: number;
          energy_before_1_10?: number | null;
          id?: string;
          notes?: string | null;
          pain_details?: string | null;
          pain_reported?: boolean;
          program_id?: string | null;
          too_easy_exercise_ids?: string[];
          too_hard_exercise_ids?: string[];
          user_id: string;
          week_index?: number;
          wellbeing_after_1_10?: number | null;
        };
        Update: {
          adaptation_decision?: string | null;
          completed_fully?: boolean;
          created_at?: string;
          day_index?: number;
          day_title?: string | null;
          difficulty_1_10?: number;
          energy_before_1_10?: number | null;
          id?: string;
          notes?: string | null;
          pain_details?: string | null;
          pain_reported?: boolean;
          program_id?: string | null;
          too_easy_exercise_ids?: string[];
          too_hard_exercise_ids?: string[];
          user_id?: string;
          week_index?: number;
          wellbeing_after_1_10?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "workout_feedback_program_id_fkey";
            columns: ["program_id"];
            isOneToOne: false;
            referencedRelation: "training_programs";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      freeze_exercise_sets: { Args: { p_sets: Json }; Returns: Json };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      normalize_promo_code: { Args: { raw: string }; Returns: string };
      publish_nutrition_version:
        | {
            Args: {
              p_client_id: string;
              p_content_hash: string;
              p_measurement_id?: string;
              p_reason?: string;
              p_recommendation_id?: string;
              p_snapshot: Json;
            };
            Returns: string;
          }
        | {
            Args: {
              p_client_id: string;
              p_content_hash: string;
              p_course_id?: string;
              p_measurement_id?: string;
              p_reason?: string;
              p_recommendation_id?: string;
              p_snapshot: Json;
            };
            Returns: string;
          };
      publish_training_version:
        | {
            Args: {
              p_client_id: string;
              p_content_hash: string;
              p_reason?: string;
              p_snapshot: Json;
            };
            Returns: string;
          }
        | {
            Args: {
              p_client_id: string;
              p_content_hash: string;
              p_course_id?: string;
              p_reason?: string;
              p_snapshot: Json;
            };
            Returns: string;
          };
      replace_training_program_days: {
        Args: { p_program_id: string; p_rows: Json };
        Returns: number;
      };
      resolve_client_course_id: {
        Args: { p_client_id: string; p_course_id?: string };
        Returns: string;
      };
    };
    Enums: {
      app_role: "admin" | "client";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["admin", "client"],
    },
  },
} as const;
