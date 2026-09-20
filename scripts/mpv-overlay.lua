-- Interface de lecture SceneRoot dessinée par mpv.
--
-- Pendant la lecture, mpv occupe l'écran devant le navigateur : l'interface web
-- ne peut pas s'y superposer. Ce script redessine donc le bandeau de lecture de
-- l'application — titre, barre de progression, temps, aide des touches — avec
-- les couleurs de SceneRoot, plus un menu des pistes audio et sous-titres et le
-- compte à rebours vers l'épisode suivant.

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
local menu = { open = false, index = 1, items = {} }
local countdown = nil       -- secondes restantes avant l'épisode suivant

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

-- ── Menu des pistes ─────────────────────────────────────────────────────────

local function label_for(track)
  local parts = {}
  if track.lang then parts[#parts + 1] = string.upper(track.lang) end
  if track.title then parts[#parts + 1] = track.title end
  if #parts == 0 then parts[#parts + 1] = 'Piste ' .. tostring(track.id) end
  if track.codec then parts[#parts + 1] = track.codec end
  return table.concat(parts, ' · ')
end

--- Construit la liste affichée : en-têtes, pistes audio puis sous-titres.
local function build_items()
  local items = { { header = 'Audio' } }
  local audio, subs = {}, {}
  for _, track in ipairs(mp.get_property_native('track-list') or {}) do
    if track.type == 'audio' then audio[#audio + 1] = track
    elseif track.type == 'sub' then subs[#subs + 1] = track end
  end
  if #audio == 0 then items[#items + 1] = { text = 'Aucune piste audio', disabled = true } end
  for _, track in ipairs(audio) do
    items[#items + 1] = { text = label_for(track), kind = 'aid', value = track.id, selected = track.selected }
  end
  items[#items + 1] = { header = 'Sous-titres' }
  local none_selected = true
  for _, track in ipairs(subs) do if track.selected then none_selected = false end end
  items[#items + 1] = { text = 'Désactivés', kind = 'sid', value = 'no', selected = none_selected }
  for _, track in ipairs(subs) do
    items[#items + 1] = { text = label_for(track), kind = 'sid', value = track.id, selected = track.selected }
  end
  return items
end

--- Prochaine entrée sélectionnable, en sautant les en-têtes.
local function selectable(items, from, step)
  local index = from
  for _ = 1, #items do
    index = index + step
    if index < 1 then index = #items elseif index > #items then index = 1 end
    if items[index].kind then return index end
  end
  return from
end

local draw  -- défini plus bas : le menu le rappelle à chaque changement.

local function close_menu()
  if not menu.open then return end
  menu.open = false
  for _, key in ipairs({ 'up', 'down', 'enter', 'esc', 'back' }) do
    mp.remove_key_binding('sceneroot-menu-' .. key)
  end
  visible_until = mp.get_time() + HIDE_AFTER
  draw()
end

local function apply_item(item)
  if not item or not item.kind then return end
  mp.set_property(item.kind, tostring(item.value))
  -- La liste reflète aussitôt le nouveau choix.
  menu.items = build_items()
  draw()
end

local function open_menu()
  menu.items = build_items()
  menu.open = true
  menu.index = 1
  for index, item in ipairs(menu.items) do
    if item.selected then menu.index = index break end
  end
  if not menu.items[menu.index].kind then menu.index = selectable(menu.items, menu.index, 1) end
  -- Tant que le menu est ouvert, ces touches lui appartiennent.
  mp.add_forced_key_binding('UP', 'sceneroot-menu-up', function()
    menu.index = selectable(menu.items, menu.index, -1); draw()
  end, { repeatable = true })
  mp.add_forced_key_binding('DOWN', 'sceneroot-menu-down', function()
    menu.index = selectable(menu.items, menu.index, 1); draw()
  end, { repeatable = true })
  mp.add_forced_key_binding('ENTER', 'sceneroot-menu-enter', function()
    apply_item(menu.items[menu.index])
  end)
  mp.add_forced_key_binding('ESC', 'sceneroot-menu-esc', close_menu)
  mp.add_forced_key_binding('BS', 'sceneroot-menu-back', close_menu)
  draw()
end

-- ── Dessin ──────────────────────────────────────────────────────────────────

-- Au-delà, la boîte dépasserait le bas de l'écran : la liste défile autour de
-- la ligne choisie plutôt que d'être dessinée hors champ.
local MENU_ROWS = 16

local function draw_menu(ass)
  local width, left, top = 760, 220, 150
  local total = #menu.items
  local rows = math.min(total, MENU_ROWS)
  -- Fenêtre centrée sur la sélection, recadrée aux bords de la liste.
  local first = 1
  if total > rows then
    first = math.max(1, math.min(menu.index - math.floor(rows / 2), total - rows + 1))
  end
  local last = math.min(total, first + rows - 1)
  local height = 120 + rows * 46
  ass:new_event()
  ass:append('{\\an7\\bord0\\shad0\\1c&H120A02&\\1a&H1A&}')
  ass:pos(0, 0)
  ass:draw_start()
  ass:round_rect_cw(left, top, left + width, top + height, 18)
  ass:draw_stop()

  ass:new_event()
  ass:append(string.format('{\\an7\\bord0\\shad0\\fs38\\1c%s}', CYAN))
  ass:pos(left + 34, top + 26)
  ass:append('Pistes audio et sous-titres')

  local y = top + 84
  for index = first, last do
    local item = menu.items[index]
    ass:new_event()
    if item.header then
      ass:append(string.format('{\\an7\\bord0\\shad0\\fs28\\1c%s}', MUTED))
      ass:pos(left + 34, y)
      ass:append(string.upper(item.header))
    else
      local current = index == menu.index
      ass:append(string.format('{\\an7\\bord0\\shad0\\fs32\\1c%s}', current and CYAN or TEXT))
      ass:pos(left + 48, y)
      ass:append((current and '▶  ' or '    ') .. (item.selected and '● ' or '○ ') .. escape(item.text))
    end
    y = y + 46
  end

  -- Rappel qu'il reste des pistes au-dessus ou au-dessous de la fenêtre.
  if first > 1 then
    ass:new_event()
    ass:append(string.format('{\\an7\\bord0\\shad0\\fs26\\1c%s}', MUTED))
    ass:pos(left + width - 52, top + 84)
    ass:append('▲')
  end
  if last < total then
    ass:new_event()
    ass:append(string.format('{\\an7\\bord0\\shad0\\fs26\\1c%s}', MUTED))
    ass:pos(left + width - 52, top + height - 78)
    ass:append('▼')
  end

  ass:new_event()
  ass:append(string.format('{\\an7\\bord0\\shad0\\fs26\\1c%s}', MUTED))
  ass:pos(left + 34, top + height - 38)
  ass:append('▲ ▼ choisir     OK valider     Retour fermer')
end

local function draw_countdown(ass)
  local left, top, width, height = 1120, 740, 680, 150
  ass:new_event()
  ass:append('{\\an7\\bord0\\shad0\\1c&H120A02&\\1a&H20&}')
  ass:pos(0, 0)
  ass:draw_start()
  ass:round_rect_cw(left, top, left + width, top + height, 18)
  ass:draw_stop()

  ass:new_event()
  ass:append(string.format('{\\an7\\bord0\\shad0\\fs40\\1c%s}', TEXT))
  ass:pos(left + 34, top + 30)
  ass:append(string.format('Épisode suivant dans %d s', countdown))

  ass:new_event()
  ass:append(string.format('{\\an7\\bord0\\shad0\\fs26\\1c%s}', MUTED))
  ass:pos(left + 34, top + 92)
  ass:append('Reculez dans l’épisode pour annuler')
end

draw = function()
  local now = mp.get_time()
  if not menu.open and countdown == nil and now > visible_until then
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

  if now <= visible_until or menu.open then
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
    ass:append('OK  pause     ◀ ▶  ±10 s     Jaune  pistes     Retour  quitter')
  end

  if countdown ~= nil then draw_countdown(ass) end
  if menu.open then draw_menu(ass) end

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
-- Menu des pistes : ouvert et refermé par la même touche.
mp.register_script_message('sceneroot-menu', function()
  if menu.open then close_menu() else open_menu() end
end)
-- Compte à rebours piloté par l'application, qui seule connaît l'épisode suivant.
mp.register_script_message('sceneroot-next', function(seconds)
  local value = tonumber(seconds)
  countdown = (value and value >= 0) and math.floor(value) or nil
  draw()
end)
-- Une pause ou un déplacement l'affiche aussi lorsqu'il vient d'ailleurs
-- (IPC de l'application, fin de mise en mémoire tampon).
mp.observe_property('pause', 'bool', show)
mp.register_event('seek', show)
mp.register_event('file-loaded', function()
  countdown = nil
  close_menu()
  show()
end)

mp.add_periodic_timer(REFRESH, draw)
show()
