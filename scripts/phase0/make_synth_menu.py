import json, random, io
from PIL import Image, ImageDraw, ImageFont, ImageFilter
random.seed(7)
items = [
 ("Per començar", [("Pa amb tomàquet", "4,50", ""), ("Escalivada amb formatge de cabra", "9,80", ""), ("Croquetes de pernil", "8,00", ""), ("Esqueixada de bacallà", "13,50", ""), ("Calçots amb salvitxada (de temporada)", "12,40", ""), ("Amanida de tomàquet, mozzarella i alfàbrega (V)", "10,70", "")]),
 ("Plats principals", [("Samfaina amb ou ferrat (V)", "11,60", ""), ("Mongetes del ganxet amb botifarra", "14,80", ""), ("Canelons de la casa", "12,90", ""), ("Arròs de verdures", "16,80", ""), ("Fideuà de peix i marisc", "18,50", ""), ("Suquet de peix", "19,10", ""), ("Truita de patates", "7,20", ""), ("Escudella", "8,60", "")]),
 ("Postres", [("Crema catalana", "5,90", ""), ("Mel i mató", "6,30", "")]),
]
truth = [{"name": n, "price": float(p.replace(',', '.')), "section": s} for s, its in items for n, p, _ in its]
json.dump(truth, open('out/synth_truth.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
def render(w=1100):
    f = lambda n, s: ImageFont.truetype(f'C:/Windows/Fonts/{n}', s)
    H = 140 + sum(70 + 52 * len(i) for _, i in items) + 80
    img = Image.new('RGB', (w, H), (247, 241, 227)); d = ImageDraw.Draw(img)
    d.text((w // 2, 50), "Restaurant Can Test", font=f('georgia.ttf', 54), fill=(60, 30, 20), anchor='mm')
    d.text((w // 2, 100), "(V) = vegetarià", font=f('georgia.ttf', 22), fill=(90, 70, 50), anchor='mm')
    y = 150
    for s, its in items:
        d.text((60, y), s.upper(), font=f('georgiab.ttf', 30), fill=(150, 40, 30)); y += 60
        for n, p, _ in its:
            d.text((60, y), n, font=f('georgia.ttf', 26), fill=(30, 30, 30)); d.text((w - 60, y), p + " €", font=f('georgia.ttf', 26), fill=(30, 30, 30), anchor='ra'); y += 52
        y += 10
    return img
base = render()
base.save('out/synth_clean.png')
b = base.resize((int(base.width * 0.45), int(base.height * 0.45)), Image.LANCZOS); buf = io.BytesIO(); b.save(buf, 'JPEG', quality=28); buf.seek(0); Image.open(buf).save('out/synth_lowres.jpg', quality=28)
p = base.rotate(4, expand=True, fillcolor=(90, 80, 70), resample=Image.BICUBIC).filter(ImageFilter.GaussianBlur(1.6))
px = p.load()
for _ in range(60000):
    x, y = random.randrange(p.width), random.randrange(p.height); v = random.randint(-45, 45); r, g, bb = px[x, y]; px[x, y] = (max(0, min(255, r + v)), max(0, min(255, g + v)), max(0, min(255, bb + v)))
p = p.resize((int(p.width * 0.6), int(p.height * 0.6)), Image.LANCZOS); p.save('out/synth_photo.jpg', quality=45)
print('done', base.size)
