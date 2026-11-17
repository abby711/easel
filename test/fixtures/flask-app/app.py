import json, urllib.request
from flask import Flask, render_template, jsonify
app = Flask(__name__)

@app.route("/")
def home():
    return render_template("index.html", title="Flask home")

@app.route("/products")
def products():
    return render_template("index.html", title="Products")

@app.route("/products/<int:pid>")
def product(pid):
    return render_template("index.html", title=f"Product {pid}")

@app.get("/api/status")
def status():
    return jsonify(ok=True)
