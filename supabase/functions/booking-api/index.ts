// ============================================================================
// POWERPLAY CLUB: SUPABASE EDGE FUNCTION (DENO / TYPESCRIPT)
// Function: booking-api
// Owner-controlled confirmation & advance payment workflow
// ============================================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.21.0";

const WHATSAPP_PHONE = "919701167899";
const DAY_RATE = 800;
const WEEKDAY_NIGHT_RATE = 1000;
const WEEKEND_NIGHT_RATE = 1200;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/booking-api/, "");

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // 1. GET /availability?date=YYYY-MM-DD
    if (req.method === "GET" && path === "/availability") {
      const dateStr = url.searchParams.get("date");
      if (!dateStr) {
        return new Response(JSON.stringify({ error: "Missing date parameter" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const nowIso = new Date().toISOString();

      // Query ONLY confirmed slots or active unexpired holds
      const { data: occupiedSlots, error } = await supabase
        .from("booking_slots")
        .select("slot_time, status, hold_expires_at")
        .eq("slot_date", dateStr)
        .in("status", ["confirmed", "held"]);

      if (error) throw error;

      // Filter out any holds that have expired
      const activeOccupied = (occupiedSlots || []).filter((s: any) => {
        if (s.status === "confirmed") return true;
        if (s.status === "held") {
          return !s.hold_expires_at || s.hold_expires_at > nowIso;
        }
        return false;
      });

      const occupiedMap = new Map(activeOccupied.map((s: any) => [
        s.slot_time.slice(0, 5),
        s.status === "confirmed" ? "booked" : "held"
      ]));

      const targetDate = new Date(`${dateStr}T12:00:00Z`);
      const isWeekend = targetDate.getUTCDay() === 0 || targetDate.getUTCDay() === 6;

      const slots = [];
      for (let h = 0; h < 24; h++) {
        const timeStr = `${String(h).padStart(2, "0")}:00`;
        const isNight = h >= 18 || h < 6;
        const price = !isNight ? DAY_RATE : isWeekend ? WEEKEND_NIGHT_RATE : WEEKDAY_NIGHT_RATE;
        const isOccupied = occupiedMap.has(timeStr);
        const slotStatus = isOccupied ? occupiedMap.get(timeStr) : "available";

        slots.push({
          hour: h,
          time: timeStr,
          available: !isOccupied,
          status: slotStatus,
          price,
          is_night: isNight,
        });
      }

      return new Response(JSON.stringify({ date: dateStr, is_weekend: isWeekend, slots }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. POST /bookings
    if (req.method === "POST" && path === "/bookings") {
      const body = await req.json();
      const { booking_type, customer_name, customer_phone, booking_date, slots, player_count, notes } = body;

      if (!customer_name || !customer_phone || !booking_date) {
        return new Response(JSON.stringify({ error: "Missing required fields" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const targetDate = new Date(`${booking_date}T12:00:00Z`);
      const isWeekend = targetDate.getUTCDay() === 0 || targetDate.getUTCDay() === 6;

      // Calculate server price
      let totalPrice = 0;
      const itemized = [];
      if (booking_type === "cricket" && Array.isArray(slots)) {
        for (const s of slots) {
          const h = parseInt(s.split(":")[0]);
          const isNight = h >= 18 || h < 6;
          const price = !isNight ? DAY_RATE : isWeekend ? WEEKEND_NIGHT_RATE : WEEKDAY_NIGHT_RATE;
          totalPrice += price;
          itemized.push({ hour: h, time: s, price });
        }
      }

      const reference = `PP-${Math.floor(1000000 + Math.random() * 9000000)}`;

      // Insert parent booking with status 'pending_confirmation'
      const { data: booking, error: bError } = await supabase
        .from("bookings")
        .insert({
          reference,
          booking_type: booking_type || "cricket",
          customer_name,
          customer_phone,
          booking_date,
          start_time: slots && slots[0] ? slots[0] : "00:00",
          end_time: slots && slots.length ? `${(parseInt(slots[slots.length - 1].split(":")[0]) + 1) % 24}:00` : "00:00",
          duration_hours: slots ? slots.length : 1,
          player_count: player_count || "6–10 Players",
          total_price: totalPrice,
          notes: notes || "",
          status: "pending_confirmation",
          advance_amount: 0.0,
          payment_verified: false,
        })
        .select()
        .single();

      if (bError) throw bError;

      // Insert non-blocking slots with status 'pending_confirmation'
      if (booking_type === "cricket" && Array.isArray(slots)) {
        const slotInserts = slots.map((s: string) => ({
          booking_id: booking.id,
          slot_date: booking_date,
          slot_time: s,
          slot_price: totalPrice / slots.length,
          status: "pending_confirmation",
        }));

        await supabase.from("booking_slots").insert(slotInserts);
      }

      // Generate WhatsApp text & link
      const waMessage = `Hello PowerPlay Club!\n\nI would like to request a Box Cricket booking.\n\nBooking ID: ${reference}\nName: ${customer_name}\nPhone: ${customer_phone}\nDate: ${booking_date}\nSlots: ${slots ? slots.join(", ") : "None"}\nTotal Price: ₹${totalPrice}\nStatus: Pending confirmation\n\nPlease check slot availability and share advance payment details to confirm.`;
      const waUrl = `https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent(waMessage)}`;

      return new Response(
        JSON.stringify({
          success: true,
          booking: { reference, status: "pending_confirmation", total_price: totalPrice },
          whatsapp: {
            url: waUrl,
            message: waMessage,
            destination: WHATSAPP_PHONE,
            instruction: "Please send the prepared WhatsApp message to PowerPlay Club. Your slot is not confirmed until the owner approves your booking and verifies the agreed advance payment."
          },
        }),
        { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ error: "Not Found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Internal Server Error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
