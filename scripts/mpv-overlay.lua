-- Interface de lecture SceneRoot dessinée par mpv.
--
-- Pendant la lecture, mpv occupe l'écran devant le navigateur : l'interface web
-- ne peut pas s'y superposer. Ce script redessine donc le bandeau de lecture de
-- l'application — titre, barre de progression, temps, aide des touches — avec
-- les couleurs de SceneRoot, et l'efface après quelques secondes sans action.

local mp = require 'mp'
local assdraw = require 'mp.assdraw'

local HIDE_AFTER = 5.0      -- secondes d'inactivité avant effacement
local REFRESH = 0.25        -- rafraîchissement pendant l'affichage
local WIDTH, HEIGHT = 1920, 1080

-- Couleurs ASS : &HBBGGRR& (l'inverse d'un code hexadécimal web).
local CYAN = '&HEED322&'    -- #22d3ee
local TEXT = '&HFAF0E6&'    -- #e6f0fa
local MUTED = '&HC0A68F&'   -- #8fa6c0
local TRACK = '&H40301D&'   -- fond de la barre

local overlay = mp.create_osd_overlay('ass-events')
local visible_until = 0

local function format_time(seconds)
  if not seconds or seconds < 0 then seconds = 0 end
  local total = math.floor(seconds)
  local hours = math.floor(total / 3600)
  local minutes = math.floor((total % 3600) / 60)
  local secs = total % 60
  if hours > 0 then return string.format('%d:%02d:%02d', hours, minutes, secs) end
  return string.format('%02d:%02d', minutes, secs)
end

local function escape(text)
  -- Une accolade dans un titre casserait le balisage ASS.
  local clean = tostring(text or ''):gsub('[{}]', '')
  return clean
end

local function draw()
  if mp.get_time() > visible_until then
    overlay:remove()
    return
  end

  local position = mp.get_property_number('time-pos', 0) or 0
  local duration = mp.get_property_number('duration', 0) or 0
  local paused = mp.get_property_bool('pause', false)
  local title = escape(mp.get_property('media-title', ''))
  local ratio = duration > 0 and math.min(1, math.max(0, position / duration)) or 0

  local margin = 90
  local bar_left, bar_right = margin, WIDTH - margin
  local bar_y = HEIGHT - 150
  local bar_h = 10

  local ass = assdraw.ass_new()

  -- Voile sombre pour détacher le bandeau de l'image.
  ass:new_event()
  ass:append('{\\an7\\bord0\\shad0\\1c&H0D0601&\\1a&H50&}')
  ass:pos(0, 0)
  ass:draw_start()
  ass:rect_cw(0, HEIGHT - 300, WIDTH, HEIGHT)
  ass:draw_stop()

  -- Titre et état de lecture.
  ass:new_event()
  ass:append(string.format('{\\an1\\bord0\\shad0\\fs46\\1c%s}', TEXT))
  ass:pos(margin, bar_y - 46)
  ass:append((paused and '⏸  ' or '▶  ') .. title)

  -- Piste de la barre, puis progression.
  ass:new_event()
  ass:append(string.format('{\\an7\\bord0\\shad0\\1c%s}', TRACK))
  ass:pos(0, 0)
  ass:draw_start()
  ass:round_rect_cw(bar_left, bar_y, bar_right, bar_y + bar_h, bar_h / 2)
  ass:draw_stop()

  if ratio > 0 then
    ass:new_event()
    ass:append(string.format('{\\an7\\bord0\\shad0\\1c%s}', CYAN))
    ass:pos(0, 0)
    ass:draw_start()
    ass:round_rect_cw(bar_left, bar_y, bar_left + (bar_right - bar_left) * ratio, bar_y + bar_h, bar_h / 2)
    ass:draw_stop()
  end

  -- Temps écoulé à gauche, restant à droite.
  ass:new_event()
  ass:append(string.format('{\\an7\\bord0\\shad0\\fs34\\1c%s}', TEXT))
  ass:pos(bar_left, bar_y + bar_h + 14)
  ass:append(format_time(position))

  ass:new_event()
  ass:append(string.format('{\\an9\\bord0\\shad0\\fs34\\1c%s}', MUTED))
  ass:pos(bar_right, bar_y + bar_h + 14)
  ass:append(duration > 0 and ('-' .. format_time(duration - position) .. '   ' .. format_time(duration)) or '')

  -- Rappel des touches : la télécommande n'a pas de légende.
  ass:new_event()
  ass:append(string.format('{\\an1\\bord0\\shad0\\fs28\\1c%s}', MUTED))
  ass:pos(margin, HEIGHT - 46)
  ass:append('OK  pause     ◀ ▶  ±10 s     Retour  quitter     Jaune  sous-titres     Rouge  audio')

  overlay.res_x = WIDTH
  overlay.res_y = HEIGHT
  overlay.data = ass.text
  overlay:update()
end

local function show()
  visible_until = mp.get_time() + HIDE_AFTER
  draw()
end

-- Chaque touche de la télécommande réveille le bandeau via input.conf.
mp.register_script_message('sceneroot-osd', show)
-- Une pause ou un déplacement l'affiche aussi lorsqu'il vient d'ailleurs
-- (IPC de l'application, fin de mise en mémoire tampon).
mp.observe_property('pause', 'bool', show)
mp.register_event('seek', show)
mp.register_event('file-loaded', show)

mp.add_periodic_timer(REFRESH, draw)
show()
