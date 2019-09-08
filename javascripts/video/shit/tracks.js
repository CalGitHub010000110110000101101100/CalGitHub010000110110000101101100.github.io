const SNAP_DIST = 10; // px
const MIN_LENGTH = 0.1; // s
const DRAG_MIN_DIST = 5; // px

class Track {

  constructor(source, props) {
    this.dragMove = this.dragMove.bind(this);
    this.dragEnd = this.dragEnd.bind(this);
    this.change = this.change.bind(this);
    this.keyChange = this.keyChange.bind(this);

    this.source = source;
    this.keys = {};
    this.props = props;
    props.props.forEach(({id, defaultVal}) => {
      if (defaultVal !== undefined) this[id] = defaultVal;
    });
    this.elem = Elem('div', {
      className: 'track',
      style: {
        backgroundImage: source.thumbnail && `url(${encodeURI(source.thumbnail)})`
      }
    }, [
      Elem('span', {className: 'trim trim-start'}),
      this.name = Elem('span', {className: 'name'}, [source.name]),
      Elem('span', {className: 'trim trim-end'}),
      this.keyWrapper = Elem('div', {className: 'keys'})
    ]);
    isDragTrigger(this.elem, (e, switchControls) => {
      if (Track.selected === this) {
        if (e.target.classList.contains('key-dot')) {
          switchControls([]);
        } else {
          switchControls(null);
        }
      } else {
        this.dragStart(e);
      }
    }, this.dragMove, this.dragEnd);
    this.placeholder = Elem('div', {className: 'track placeholder'});
    this.updateScale();
  }

  get end() {
    return this.start + this.length;
  }

  set end(end) {
    this.length = end - this.start;
  }

  // sets this.start while keeping this.end constant
  setLeftSide(start) {
    this.length = this.end - start;
    this.start = start;
  }

  updateLength() {
    this.elem.style.setProperty('--start', this.start * scale + 'px');
    this.elem.style.setProperty('--length', this.length * scale + 'px');
  }

  updateScale() {
    this.updateLength();
    Object.values(this.keys).forEach(keys => keys.forEach(key => {
      key.elem.style.left = key.time * scale + 'px';
    }));
  }

  dragStart({clientX, clientY, target}, offsets, dragImmediately = false) {
    if (dragImmediately) {
      this.startDragging(clientX, clientY, target, offsets);
    } else {
      this.dragStartData = [clientX, clientY, target, offsets];
      this.dragging = false;
    }
  }

  startDragging(clientX, clientY, target, offsets) {
    this.dragging = true;
    this.timelineLeft = layersWrapper.getBoundingClientRect().left + scrollX;
    this.currentState = getEntry();
    if (target.classList.contains('trim')) {
      this.trimming = true;
      document.body.classList.add('trimming');
      this.trimmingStart = target.classList.contains('trim-start');
      if (this.trimmingStart) {
        this.init = this.start;
        this.trimMin = this.index > 0
          ? this.layer.tracks[this.index - 1].end
          : 0;
        this.trimMax = this.end - MIN_LENGTH;
      } else {
        this.init = this.end;
        this.trimMin = this.start + MIN_LENGTH;
        this.trimMax = this.index < this.layer.tracks.length - 1
          ? this.layer.tracks[this.index + 1].start
          : Infinity;
      }
      this.jumpPoints = getAllJumpPoints();
      // do not snap to other side
      const index = this.jumpPoints.indexOf(this.trimmingStart ? this.end : this.start);
      if (~index) this.jumpPoints.splice(index, 1);
    } else {
      if (this.layer) {
        this.layer.tracks.splice(this.index, 1);
        this.layer.updateTracks();
      }
      this.layerBounds = getLayerBounds();
      this.jumpPoints = getAllJumpPoints();
      if (!offsets) {
        const {left, top} = this.elem.getBoundingClientRect();
        offsets = [clientX - left, clientY - top];
      }
      this.dragOffsets = offsets;
      this.elem.classList.add('dragging');
      this.elem.style.left = clientX - offsets[0] + 'px';
      this.elem.style.top = clientY - offsets[1] + 'px';
      document.body.appendChild(this.elem);
      this.possibleLayer = null;
      this.placeholder.style.setProperty('--length', this.length * scale + 'px');
    }
  }

  dragMove({clientX, clientY, shiftKey}) {
    if (!this.dragging) {
      if (Math.hypot(clientX - this.dragStartData[0], clientY - this.dragStartData[1]) > DRAG_MIN_DIST) {
        this.startDragging(...this.dragStartData);
      } else {
        return;
      }
    }
    if (this.trimming) {
      let cursor = (clientX + scrollX - this.timelineLeft) / scale;
      // TODO: snapping for loop borders
      if (!shiftKey) cursor = Track.snapPoint(this.jumpPoints, cursor);
      if (cursor < this.trimMin) cursor = this.trimMin;
      else if (cursor > this.trimMax) cursor = this.trimMax;
      if (this.trimmingStart) {
        this.setLeftSide(cursor);
      } else {
        this.end = cursor;
      }
      this.updateLength();
      this.displayProperties();
      return;
    }
    const placeholder = this.placeholder;
    if (clientY < this.layerBounds[0].top) {
      if (this.possibleLayer) {
        placeholder.parentNode.removeChild(placeholder);
        this.possibleLayer = null;
      }
    } else {
      const {layer} = this.layerBounds.find(({bottom}) => clientY < bottom - scrollY)
        || this.layerBounds[this.layerBounds.length - 1];
      if (this.possibleLayer !== layer) {
        this.possibleLayer = layer;
        layer.elem.appendChild(placeholder);
      }
      this.possibleStart = (clientX - this.dragOffsets[0] + scrollX - this.timelineLeft) / scale;
      if (!shiftKey) {
        this.possibleStart = Track.snapPoint(
          this.jumpPoints,
          this.possibleStart,
          this.possibleStart + this.length
        );
      }
      if (this.possibleStart < 0) this.possibleStart = 0;
      placeholder.style.setProperty('--start', this.possibleStart * scale + 'px');
    }
    this.elem.style.left = clientX - this.dragOffsets[0] + 'px';
    this.elem.style.top = clientY - this.dragOffsets[1] + 'px';
  }

  dragEnd(e) {
    this.init = null;
    if (!this.dragging) {
      if (Track.selected) Track.selected.unselected();
      this.selected();
      setPreviewTime(Math.max((e.clientX + scrollX - LEFT) / scale, 0));
      return;
    }
    this.timelineLeft = null;
    this.jumpPoints = null;
    if (this.trimming) {
      log(this.currentState);
      this.trimming = false;
      document.body.classList.remove('trimming');
      Object.values(this.keys).forEach(keys => {
        const outOfBound = keys.findIndex(({time}) => time > this.length);
        if (~outOfBound) {
          keys.splice(outOfBound, keys.length - outOfBound)
            .forEach(key => {
              keys.elem.removeChild(key.elem);
            });
        }
      });
      rerender();
      return;
    }
    this.layerBounds = null;
    this.dragOffsets = null;
    this.elem.classList.remove('dragging');
    this.elem.style.left = null;
    this.elem.style.top = null;
    const layer = this.possibleLayer;
    if (layer) {
      log(this.currentState);
      this.placeholder.parentNode.removeChild(this.placeholder);
      this.start = this.possibleStart;
      this.updateLength();
      if (layer.tracksBetween(this.start, this.end).length) {
        if (layer.index > 0 && !layers[layer.index - 1].tracksBetween(this.start, this.end).length) {
          layers[layer.index - 1].addTrack(this);
        } else {
          const newLayer = new Layer();
          layer.insertBefore(newLayer);
          newLayer.addTrack(this);
        }
      } else {
        layer.addTrack(this);
      }
    } else {
      this.remove('drag-delete');
    }
    this.possibleLayer = null;
    this.possibleStart = null;
    this.currentState = null;
    rerender();
    this.displayProperties();
  }

  selected() {
    Track.selected = this;
    document.body.classList.add('has-selection');
    this.layer.elem.classList.add('has-selected');
    this.elem.classList.add('selected');
    Object.keys(this.keys).forEach(id => {
      if (!this.keys[id].length) {
        this.keyWrapper.removeChild(this.keys[id].elem);
        delete this.keys[id];
      }
    });
    this.displayProperties();
    this.props.handler = this.change;
    this.props.keyHandler = this.keyChange;
    propertiesList.appendChild(this.props.elem);
  }

  unselected() {
    Track.selected = null;
    document.body.classList.remove('has-selection');
    this.layer.elem.classList.remove('has-selected');
    this.elem.classList.remove('selected');
    propertiesList.removeChild(this.props.elem);
  }

  remove(reason) {
    if (reason !== 'layer-removal') {
      if (this.elem.parentNode) {
        this.elem.parentNode.removeChild(this.elem);
      }
      if (this.layer) {
        log(this.currentState || getEntry());
        this.layer.tracks.splice(this.index, 1);
        this.layer.updateTracks();
      }
    }
    if (Track.selected === this) {
      this.unselected();
    }
  }

  change(prop, value, isFinal) {
    if (isFinal) {
      log(this.propChangesLog);
      this.propChangesLog = null;
    } else if (!this.propChangesLog) {
      this.propChangesLog = getEntry();
    }
    const returnVal = this.showChange(prop, value, isFinal);
    if (returnVal !== undefined) value = returnVal;
    this[prop] = value;
    rerender();
    if (isFinal) {
      if (this.keys[prop] && this.keys[prop].length) {
        const relTime = clamp(previewTime - this.start, 0, this.length);
        const key = this.keys[prop].find(({time}) => time === relTime);
        if (key) {
          key.value = value;
        } else {
          this.insertKey(prop, {value, time: relTime});
          this.props.keys[prop].classList.add('active');
        }
      }
    }
    return returnVal;
  }

  showChange(prop, value, isFinal) {
    let returnVal;
    switch (prop) {
      case 'start':
        if (value < 0) value = returnVal = 0;
        this.start = value;
        if (isFinal) {
          this.layer.tracks.splice(this.index, 1);
          const intersections = this.layer.tracksBetween(value, value + this.length);
          if (intersections.length) {
            this.layer.updateTracks();
            const newLayer = new Layer();
            this.layer.insertBefore(newLayer);
            newLayer.addTrack(this);
          } else {
            this.layer.addTrack(this);
          }
        }
        returnVal = this.start;
        this.updateLength();
        break;
      case 'length':
        if (value < MIN_LENGTH) value = returnVal = MIN_LENGTH;
        if (isFinal) {
          if (this.index < this.layer.tracks.length - 1) {
            if (this.layer.tracks[this.index + 1].start < this.start + value) {
              value = returnVal = this.layer.tracks[this.index + 1].start - this.start;
            }
          }
          Object.values(this.keys).forEach(keys => {
            const outOfBound = keys.findIndex(({time}) => time > value);
            if (~outOfBound) {
              keys.splice(outOfBound, keys.length - outOfBound)
                .forEach(key => {
                  keys.elem.removeChild(key.elem);
                });
            }
          });
        }
        this.length = value;
        this.updateLength();
        break;
    }
    return returnVal;
  }

  keyChange(id, keyed) {
    log();
    const relTime = clamp(previewTime - this.start, 0, this.length);
    if (keyed) {
      this.insertKey(id, {value: this[id], time: relTime});
    } else {
      const index = this.keys[id].findIndex(({time}) => time === relTime);
      if (~index) {
        this.keys[id].elem.removeChild(this.keys[id][index].elem);
        this.keys[id].splice(index, 1);
      } else {
        console.log('could not find key yet it said there was key');
      }
    }
  }

  insertKey(id, key) {
    key.elem = Elem('div', {
      className: 'key-dot',
      style: {
        left: key.time * scale + 'px'
      },
      onclick: e => setPreviewTime(key.time + this.start)
    });
    if (!this.keys[id]) {
      this.keys[id] = [];
      this.keys[id].elem = Elem('div', {className: 'key-row'}, [
        Elem('div', {className: 'key-label'}, [this.props.props.find(p => p.id === id).label])
      ]);
      this.keyWrapper.appendChild(this.keys[id].elem);
    }
    this.keys[id].elem.appendChild(key.elem);
    const index = this.keys[id].findIndex(({time}) => time > key.time);
    if (~index) this.keys[id].splice(index, 0, key);
    else this.keys[id].push(key);
  }

  displayProperties() {
    if (Track.selected === this) {
      const relTime = clamp(previewTime - this.start, 0, this.length);
      this.interpolate(relTime);
      this.props.setValues(this);
      this.props.props.forEach(({id, animatable}) => {
        if (animatable) {
          if (this.keys[id] && this.keys[id].find(({time}) => time === relTime)) {
            this.props.keys[id].classList.add('active');
          } else {
            this.props.keys[id].classList.remove('active');
          }
        }
      });
    }
  }

  prepare() {
    return Promise.resolve();
  }

  interpolate(relTime) {
    Object.keys(this.keys).forEach(id => {
      const keys = this.keys[id];
      if (keys.length === 1) {
        this[id] = keys[0].value;
      } else if (keys.length > 1) {
        const index = keys.findIndex(({time}) => time >= relTime);
        if (!~index) {
          this[id] = keys[keys.length - 1].value;
        } else if (keys[index].time === relTime || index === 0) {
          this[id] = keys[index].value;
        } else {
          this[id] = keys[index - 1].value + interpolate(
            (relTime - keys[index - 1].time) / (keys[index].time - keys[index - 1].time),
            keys[index].ease
          ) * (keys[index].value - keys[index - 1].value);
        }
      }
    });
  }

  render(ctx, time) {
    this.interpolate(time);
  }

  stop() {
    // do nothing
  }

  setProps(values) {
    this.props.props.forEach(({id}) => {
      if (values[id] !== undefined) {
        this[id] = values[id];
      }
    });
    Object.keys(values.keys).forEach(id => {
      this.keys[id] = values.keys[id];
      this.keys[id].elem = Elem('div', {className: 'key-row'}, [
        Elem('div', {className: 'key-label'}, [this.props.props.find(p => p.id === id).label])
      ]);
      this.keys[id].forEach(key => {
        key.elem = Elem('div', {
          className: 'key-dot',
          style: {
            left: key.time * scale + 'px'
          },
          onclick: e => setPreviewTime(key.time + this.start)
        });
        this.keys[id].elem.appendChild(key.elem);
      });
      this.keyWrapper.appendChild(this.keys[id].elem);
    });
  }

  toJSON() {
    const keys = {};
    Object.keys(this.keys).forEach(id => {
      if (this.keys[id].length) {
        keys[id] = this.keys[id].map(({time, value}) => ({time, value}));
      }
    });
    const obj = {
      source: this.source.id,
      selected: Track.selected === this,
      keys
    };
    this.props.props.forEach(({id}) => obj[id] = this[id]);
    return obj;
  }

  // returns jumpPoint relative to currentTime, even if it snaps
  // according to altTime
  static snapPoint(jumpPoints, currentTime, altTime) {
    let jumpPoint = currentTime, minDist = Infinity;
    jumpPoints.forEach(time => {
      const dist = Math.abs(time - currentTime);
      const altDist = Math.abs(time - altTime);
      if (dist < SNAP_DIST / scale && dist < minDist) {
        jumpPoint = time;
        minDist = dist;
      } else if (altDist < SNAP_DIST / scale && altDist < minDist) {
        jumpPoint = time - (altTime - currentTime);
        minDist = altDist;
      }
    });
    return jumpPoint;
  }

}

class MediaTrack extends Track {

  constructor(source, props) {
    super(
      source,
      props
    );
    this.trimEnd = this.source.length;
    this.updateLength();
  }

  get length() {
    return this.trimEnd - this.trimStart;
  }

  set length(len) {
    this.trimEnd = this.trimStart + len;
  }

  setLeftSide(start) {
    this.trimStart = this.trimStart + start - this.start;
    this.start = start;
  }

  updateLength() {
    super.updateLength();
    this.elem.style.backgroundPosition = -this.trimStart * scale + 'px';
  }

  updateScale() {
    super.updateScale();
    this.elem.style.backgroundSize = this.source.length * scale + 'px';
  }

  showChange(prop, value, isFinal) {
    let returnVal;
    switch (prop) {
      case 'volume':
        if (value > 100) return 100;
        else if (value < 0) return 0;
      case 'trimStart':
        if (value > this.trimEnd - MIN_LENGTH) return this.trimEnd - MIN_LENGTH;
      case 'trimEnd':
        if (value < this.trimStart + MIN_LENGTH) return this.trimStart + MIN_LENGTH;
      default:
        return super.showChange(prop, value, isFinal);
    }
    return returnVal;
  }

  prepare(relTime) {
    return new Promise(res => {
      this.media.addEventListener('timeupdate', res, {once: true});
      this.media.currentTime = mod(relTime + this.trimStart, this.source.length);
    });
  }

  render(ctx, time, play = false) {
    super.render(ctx, time, play);
    this.media.volume = this.volume / 100;
    if (play) this.media.play();
  }

  stop() {
    this.media.pause();
  }

}

class VideoTrack extends MediaTrack {

  static get props() {
    return this._props || (this._props = new Properties([
      ...baseProps,
      ...mediaProps,
      ...graphicalProps
    ]));
  }

  constructor(source) {
    super(source, VideoTrack.props);
    this.elem.classList.add('video');
    let videoLoaded;
    this.mediaLoaded = new Promise(res => videoLoaded = res);
    this.media = Elem('video', {
      src: this.source.url,
      loop: true,
      onloadeddata: e => {
        if (this.media.readyState < 2) return;
        videoLoaded();
      }
    });
  }

  showChange(prop, value, isFinal) {
    let returnVal;
    switch (prop) {
      case 'opacity':
        if (value > 100) return 100;
        else if (value < 0) return 0;
      default:
        return super.showChange(prop, value, isFinal);
    }
    return returnVal;
  }

  render(ctx, time, play = false) {
    super.render(ctx, time, play);
    ctx.save();
    ctx.translate(ctx.canvas.width * (this.xPos + 1) / 2, ctx.canvas.height * (1 - this.yPos) / 2);
    ctx.rotate(this.rotation * Math.PI / 180);
    ctx.scale(this.xScale, this.yScale);
    ctx.globalAlpha = this.opacity / 100;
    let width, height;
    if (this.source.width / this.source.height > ctx.canvas.width / ctx.canvas.height) {
      width = ctx.canvas.height / this.source.height * this.source.width, height = ctx.canvas.height;
    } else {
      width = ctx.canvas.width, height = ctx.canvas.width / this.source.width * this.source.height;
    }
    ctx.drawImage(this.media, -width / 2, -height / 2, width, height);
    ctx.restore();
  }

}

class AudioTrack extends MediaTrack {

  static get props() {
    return this._props || (this._props = new Properties([
      ...baseProps,
      ...mediaProps
    ]));
  }

  constructor(source) {
    super(source, AudioTrack.props);
    this.elem.classList.add('audio');
    this.media = new Audio(this.source.url);
    this.mediaLoaded = new Promise(res => this.media.onload = res);
    this.media.loop = true;
  }

}

class ImageTrack extends Track {

  static get props() {
    return this._props || (this._props = new Properties([
      ...baseProps,
      lengthProp,
      ...graphicalProps
    ]));
  }

  constructor(source) {
    super(
      source,
      ImageTrack.props
    );
    this.elem.classList.add('image');
  }

  showChange(prop, value, isFinal) {
    let returnVal;
    switch (prop) {
      case 'opacity':
        if (value > 100) return 100;
        else if (value < 0) return 0;
      default:
        return super.showChange(prop, value, isFinal);
    }
    return returnVal;
  }

  render(ctx, time) {
    super.render(ctx, time);
    ctx.save();
    ctx.translate(ctx.canvas.width * (this.xPos + 1) / 2, ctx.canvas.height * (1 - this.yPos) / 2);
    ctx.rotate(this.rotation * Math.PI / 180);
    ctx.scale(this.xScale, this.yScale);
    ctx.globalAlpha = this.opacity / 100;
    let width, height;
    if (this.source.width / this.source.height > ctx.canvas.width / ctx.canvas.height) {
      width = ctx.canvas.height / this.source.height * this.source.width, height = ctx.canvas.height;
    } else {
      width = ctx.canvas.width, height = ctx.canvas.width / this.source.width * this.source.height;
    }
    ctx.drawImage(this.source.image, -width / 2, -height / 2, width, height);
    ctx.restore();
  }

}

class TextTrack extends Track {

  static get props() {
    return this._props || (this._props = new Properties([
      {
        id: 'font',
        label: 'Font',
        defaultVal: 'Open Sans'
      },
      {
        id: 'content',
        label: 'Text',
        defaultVal: 'Xi Jinping eats, shoots, and [removed]!'
      },
      ...baseProps,
      lengthProp,
      ...graphicalProps,
      {
        id: 'hColour',
        label: 'Hue',
        unit: '°',
        digits: 0,
        range: 360,
        defaultVal: 180,
        animatable: true
      },
      {
        id: 'sColour',
        label: 'Saturation',
        unit: '%',
        digits: 0,
        range: 100,
        defaultVal: 100,
        animatable: true
      },
      {
        id: 'lColour',
        label: 'Lightness',
        unit: '%',
        digits: 0,
        range: 100,
        defaultVal: 100,
        animatable: true
      }
    ]));
  }

  constructor() {
    super(sources.text, TextTrack.props);
    this.elem.classList.add('text');
    this.name.textContent = this.content;
  }

  showChange(prop, value, isFinal) {
    let returnVal;
    switch (prop) {
      case 'content':
        this.name.textContent = value;
        break;
      case 'sColour':
      case 'lColour':
      case 'opacity':
        if (value > 100) return 100;
        else if (value < 0) return 0;
      default:
        return super.showChange(prop, value, isFinal);
    }
    return returnVal;
  }

  render(ctx, time) {
    super.render(ctx, time);
    ctx.save();
    ctx.translate(ctx.canvas.width * (this.xPos + 1) / 2, ctx.canvas.height * (1 - this.yPos) / 2);
    ctx.rotate(this.rotation * Math.PI / 180);
    ctx.scale(this.xScale, this.yScale);
    ctx.fillStyle = `hsla(${mod(this.hColour, 360)}, ${this.sColour}%, ${this.lColour}%, ${this.opacity / 100})`;
    ctx.font = `50px "${this.font.replace(/"/g, '\\"')}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.content, 0, 0);
    ctx.restore();
  }

}