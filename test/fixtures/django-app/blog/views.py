from django.http import HttpResponse
from django.contrib.auth.decorators import login_required

PAGE = """<!doctype html><html><head><title>{t}</title><style>body{{font-family:Georgia,serif;color:#333;padding:24px}} .pill{{background:#14b8a6;color:#fff;border-radius:999px;padding:2px 8px}}</style></head>
<body><h1>{t}</h1><span class="pill">django</span><p><a href="/">Home</a> · <a href="/posts/1/">Post 1</a> · <a href="/archive/2024/">2024</a> · <a href="/accounts/profile/">Profile</a></p></body></html>"""

def index(request):
    return HttpResponse(PAGE.format(t="Blog home"))

def detail(request, pk):
    return HttpResponse(PAGE.format(t=f"Post {pk}"))

def archive(request, year):
    return HttpResponse(PAGE.format(t=f"Archive {year}"))

@login_required
def profile(request):
    return HttpResponse(PAGE.format(t="Your profile"))
