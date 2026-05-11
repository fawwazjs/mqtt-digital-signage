"""Shared demo deployment data for the ITS signage fleet."""

DISPLAYS = [
    {"id": "ITS01", "name": "Graha ITS Main Lobby", "zone": "Graha", "building": "Graha ITS", "floor": 1, "lat": -7.28102, "lng": 112.79512},
    {"id": "ITS02", "name": "Perpustakaan ITS Entrance", "zone": "Library", "building": "ITS Library", "floor": 1, "lat": -7.28216, "lng": 112.79372},
    {"id": "ITS03", "name": "Research Center Corridor", "zone": "Research", "building": "Research Center", "floor": 2, "lat": -7.27972, "lng": 112.79708},
    {"id": "ITS04", "name": "Kantin Pusat Queue", "zone": "Canteen", "building": "Kantin Pusat", "floor": 1, "lat": -7.28336, "lng": 112.79642},
]

ZONES = {
    "Graha": {"building": "Graha ITS", "label": "Graha ITS"},
    "Library": {"building": "ITS Library", "label": "Library"},
    "Research": {"building": "Research Center", "label": "Research"},
    "Canteen": {"building": "Kantin Pusat", "label": "Canteen"},
}

CAMPAIGNS = [
    {"id": "CAMP_GRAHA_WELCOME", "content": "Welcome to ITS Campus", "type": "image", "duration": 20, "zone": "Graha"},
    {"id": "CAMP_LIBRARY_HOURS", "content": "Library Hours: 08:00-21:00", "type": "html", "duration": 45, "zone": "Library"},
    {"id": "CAMP_RESEARCH_EXPO", "content": "ITS Research Expo Today", "type": "video", "duration": 30, "zone": "Research"},
    {"id": "CAMP_CANTEEN_MENU", "content": "Kantin Pusat: Lunch Queue Updates", "type": "image", "duration": 20, "zone": "Canteen"},
    {"id": "CAMP_GRAHA_EVENT", "content": "Graha ITS: Auditorium Event Starts 14:00", "type": "html", "duration": 50, "display_id": "ITS01"},
]

ZONE_TYPES = {
    "Graha": "campus_hall",
    "Library": "study_area",
    "Research": "academic",
    "Canteen": "food_court",
}
